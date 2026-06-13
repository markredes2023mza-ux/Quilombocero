// ============================================================================
//  Netlify Function: generar-calendario
//  Proxy serverless hacia la API de Anthropic (Claude). La API key NUNCA va en
//  el front: se lee de la variable de entorno ANTHROPIC_API_KEY de Netlify.
//
//  Genera UN SOLO DÍA por llamada (la app la llama 6 veces, lunes..sábado),
//  para entrar holgado en el límite de ~10s de las funciones del plan gratis.
//  Recibe contexto + stock + tema de la semana + qué día + días ya hechos,
//  y devuelve SOLO el JSON de ese día.
// ============================================================================

exports.handler = async function (event) {
  const json = (code, obj) => ({
    statusCode: code,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(obj),
  });

  if (event.httpMethod !== "POST") {
    return json(405, { error: "Método no permitido. Usá POST." });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return json(500, { error: "Falta configurar ANTHROPIC_API_KEY en Netlify (Site configuration → Environment variables)." });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return json(400, { error: "El pedido no es un JSON válido." });
  }

  const ctx = payload.contexto || {};
  const stock = (payload.stock || "").trim();
  const tema = (payload.tema || "").trim();
  const dia = (payload.dia || "lunes").trim();
  const proponerTema = !!payload.proponer_tema;
  const previos = Array.isArray(payload.previos) ? payload.previos : [];

  const previosTxt = previos.length
    ? previos.map(function (p) { return "- " + p.dia + ": " + (p.tema_del_dia || ""); }).join("\n")
    : "(ninguno todavía)";

  const sistema =
    "Sos un estratega de contenidos de redes sociales, creativo y disruptivo, para la agencia Boox. " +
    "Planificás el contenido de UN SOLO DÍA para Phone Shop (venta de tecnología). " +
    "Respondés SIEMPRE y SOLO con un objeto JSON válido: sin texto antes ni después, sin markdown, sin explicaciones.\n\n" +
    "FORMA EXACTA del JSON:\n" +
    '{' + (proponerTema ? '"tema_semana":"texto",' : '') + '"tema_del_dia":"texto","contenidos":[{"tipo":"story|reel|carrusel","momento":"HH:MM o null","rubro":"texto","idea":"texto","objetivo":"vender|alcance|comunidad","copy_sugerido":"texto","prompt_diseno":"texto (SOLO en stories)"}]}\n\n' +
    "REGLAS ESTRATÉGICAS (obligatorias):\n" +
    "- La cuenta tiene ALCANCE BAJO: priorizá recuperar alcance con reels de humor/tendencia y dinámicas/juegos con premio o descuento, SIN descuidar la venta. Balance 50% vender / 50% alcance.\n" +
    "- El día gira en torno a la TEMÁTICA SEMANAL; poné el eje del día en tema_del_dia.\n" +
    "- ESTRUCTURA DIARIA DE STORIES, en este orden: 1) apertura 08:00 con dirección y horarios ('buen día, ya abrimos'); 2-3) temática del día; 4) recordatorio de servicio técnico; 5-6) cierre (repaso / llamado a la acción). Sumá 1 reel o carrusel si aporta (humor/tendencia/dinámica para alcance o destacado de venta).\n" +
    "- Mostrá PRECIOS cuando corresponda (diferencial). Usá el stock del día para destacados de venta concretos.\n" +
    "- NADA genérico ni con olor a IA: disruptivo, creativo, original, que conecte (de valor, educativo y de entretenimiento).\n" +
    "- copy_sugerido breve (máx ~120 caracteres).\n" +
    "- PROMPT DE DISEÑO (SOLO en contenidos tipo 'story'): campo prompt_diseno, indicación breve y natural en español lista para pegar en ChatGPT, que describa el CONTENIDO de esa story (idea, gancho/copy, producto y precio si aplica, y su rol en la estructura del día). NO describas colores, fuentes ni estilo: ChatGPT YA conoce la estética de Phone Shop. Reels y carruseles NO llevan prompt_diseno." +
    (proponerTema ? "\n- Como no hay tema de la semana, proponé uno coherente y devolvelo en tema_semana." : "");

  const usuario =
    "Cliente: Phone Shop. Generá SOLO el día: " + dia + ".\n\n" +
    "=== TEMA DE LA SEMANA ===\n" + (tema ? tema : "(vacío — proponelo vos en tema_semana)") + "\n\n" +
    "=== DÍAS YA GENERADOS (no repitas ideas/temas) ===\n" + previosTxt + "\n\n" +
    "=== CONTEXTO / FICHA ===\n" +
    "Rubros / catálogo: " + (ctx.rubros || "(sin datos)") + "\n" +
    "Objetivos: " + (ctx.objetivos || "(sin datos)") + "\n" +
    "Reglas fijas: " + (ctx.reglas || "(sin datos)") + "\n" +
    "Tono de marca: " + (ctx.tono || "(sin datos)") + "\n" +
    "Qué funciona / qué no queremos: " + (ctx.notas || "(sin datos)") + "\n\n" +
    "=== STOCK DEL DÍA ===\n" + (stock ? stock : "(sin stock cargado — sugerí destacados del catálogo sin inventar precios)") + "\n\n" +
    "Devolvé SOLO el JSON de ese día.";

  let resp;
  try {
    resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1500,
        system: sistema,
        messages: [{ role: "user", content: usuario }],
      }),
    });
  } catch (e) {
    return json(502, { error: "No se pudo contactar a la IA. Probá de nuevo." });
  }

  if (!resp.ok) {
    let detalle = "";
    try { detalle = await resp.text(); } catch (e) {}
    if (resp.status === 401) return json(502, { error: "La API key de Anthropic es inválida o expiró." });
    if (resp.status === 429) return json(502, { error: "La IA está saturada (límite de uso). Probá de nuevo en un rato." });
    return json(502, { error: "La IA devolvió un error.", detalle: detalle.slice(0, 300) });
  }

  let data;
  try { data = await resp.json(); } catch (e) {
    return json(502, { error: "La IA devolvió una respuesta ilegible." });
  }

  let texto = "";
  if (data && Array.isArray(data.content)) {
    texto = data.content.filter(function (b) { return b.type === "text"; }).map(function (b) { return b.text; }).join("");
  }

  let dd = null;
  try { dd = JSON.parse(texto); } catch (e) {
    const a = texto.indexOf("{"), z = texto.lastIndexOf("}");
    if (a !== -1 && z !== -1 && z > a) { try { dd = JSON.parse(texto.slice(a, z + 1)); } catch (e2) {} }
  }

  if (!dd || !Array.isArray(dd.contenidos)) {
    return json(502, { error: "La IA no devolvió el día en el formato esperado." });
  }

  return json(200, dd);
};
