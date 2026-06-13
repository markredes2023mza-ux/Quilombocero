// ============================================================================
//  Netlify Function: generar-calendario
//  Proxy serverless hacia la API de Anthropic (Claude). La API key NUNCA va en
//  el front: se lee de la variable de entorno ANTHROPIC_API_KEY de Netlify.
//  Recibe el contexto del cliente + el stock del día + el tema de la semana,
//  y devuelve SOLO el JSON del calendario semanal.
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

  const sistema =
    "Sos un estratega de contenidos de redes sociales, creativo y disruptivo, para la agencia Boox. " +
    "Planificás semanas de contenido para Phone Shop (venta de tecnología). " +
    "Respondés SIEMPRE y SOLO con un objeto JSON válido: sin texto antes ni después, sin markdown, sin explicaciones.\n\n" +
    "FORMA EXACTA del JSON:\n" +
    '{"tema_semana":"texto","dias":[{"dia":"lunes","tema_del_dia":"texto","contenidos":[{"tipo":"story|reel|carrusel","momento":"HH:MM o null","rubro":"texto","idea":"texto","objetivo":"vender|alcance|comunidad","copy_sugerido":"texto","prompt_diseno":"texto (SOLO en stories)"}]}]}\n\n' +
    "Incluí los días de lunes a sábado.\n\n" +
    "REGLAS ESTRATÉGICAS (obligatorias):\n" +
    "- La cuenta tiene ALCANCE BAJO. Priorizá recuperar alcance con reels de humor/tendencia y dinámicas/juegos con premio o descuento, SIN descuidar la venta. Balance 50% vender / 50% alcance.\n" +
    "- Trabajá toda la semana alrededor de una TEMÁTICA SEMANAL (un eje). Si te paso un 'Tema de la semana', respetalo; si viene vacío, proponé uno coherente y ponelo en tema_semana. Cada día tiene su tema_del_dia, derivado del eje semanal.\n" +
    "- ESTRUCTURA DIARIA DE STORIES (lunes a sábado), con hilo conductor, EN ESTE ORDEN:\n" +
    "    1) Story de apertura 08:00 con dirección y horarios ('buen día, ya abrimos').\n" +
    "    2-3) Stories de la temática del día/semana.\n" +
    "    4) Recordatorio de servicio técnico.\n" +
    "    5-6) Stories de cierre (cierre del día / repaso / llamado a la acción).\n" +
    "  Además de esas stories, sumá 1 reel o carrusel por día cuando aporte (humor/tendencia/dinámica para alcance, o destacado de venta).\n" +
    "- Mostrá PRECIOS cuando corresponda (es un diferencial). Usá el 'Stock del día' para sugerir destacados de venta concretos con precio real.\n" +
    "- NADA genérico ni que parezca hecho por IA: contenido disruptivo, creativo, original, que conecte (de valor, educativo y de entretenimiento).\n" +
    "- El copy_sugerido debe ser breve y accionable (máx ~140 caracteres). No repitas ideas iguales entre días.\n" +
    "- PROMPT DE DISEÑO (SOLO para contenidos de tipo 'story'): agregá el campo prompt_diseno con una indicación breve, natural y concreta en español, lista para pegar en ChatGPT para diseñar ESA story. Debe decir: qué muestra / cuál es la idea, el gancho o copy principal, producto y precio si aplica (usando el stock del día cuando corresponda), y su rol en la estructura del día (apertura con dirección y horarios / temática / recordatorio de servicio técnico / cierre). NO describas colores, fuentes ni estilo visual: ChatGPT YA conoce la estética de Phone Shop. Que suene como se lo pediría una persona, no robótico. Los reels y carruseles NO llevan prompt_diseno.";

  const usuario =
    "Cliente: Phone Shop.\n\n" +
    "=== CONTEXTO / FICHA ===\n" +
    "Rubros / catálogo: " + (ctx.rubros || "(sin datos)") + "\n" +
    "Objetivos: " + (ctx.objetivos || "(sin datos)") + "\n" +
    "Reglas fijas: " + (ctx.reglas || "(sin datos)") + "\n" +
    "Tono de marca: " + (ctx.tono || "(sin datos)") + "\n" +
    "Qué funciona / qué no queremos: " + (ctx.notas || "(sin datos)") + "\n\n" +
    "=== TEMA DE LA SEMANA ===\n" +
    (tema ? tema : "(vacío — proponé uno coherente y devolvelo en tema_semana)") + "\n\n" +
    "=== STOCK DEL DÍA (para destacados de venta con precio) ===\n" +
    (stock ? stock : "(sin stock cargado — igual generá el plan; sugerí destacados genéricos del catálogo sin inventar precios)") + "\n\n" +
    "Generá el calendario semanal en el JSON pedido, respetando las reglas estratégicas y la estructura diaria de stories. Recordá: SOLO el JSON.";

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
        max_tokens: 5000,
        system: sistema,
        messages: [{ role: "user", content: usuario }],
      }),
    });
  } catch (e) {
    return json(502, { error: "No se pudo contactar a la IA. Probá de nuevo en un momento." });
  }

  if (!resp.ok) {
    let detalle = "";
    try { detalle = await resp.text(); } catch (e) {}
    if (resp.status === 401) return json(502, { error: "La API key de Anthropic es inválida o expiró." });
    if (resp.status === 429) return json(502, { error: "La IA está saturada (límite de uso). Probá de nuevo en un rato." });
    return json(502, { error: "La IA devolvió un error.", detalle: detalle.slice(0, 500) });
  }

  let data;
  try { data = await resp.json(); } catch (e) {
    return json(502, { error: "La IA devolvió una respuesta ilegible." });
  }

  let texto = "";
  if (data && Array.isArray(data.content)) {
    texto = data.content.filter(function (b) { return b.type === "text"; }).map(function (b) { return b.text; }).join("");
  }

  let cal = null;
  try { cal = JSON.parse(texto); } catch (e) {
    const a = texto.indexOf("{"), z = texto.lastIndexOf("}");
    if (a !== -1 && z !== -1 && z > a) {
      try { cal = JSON.parse(texto.slice(a, z + 1)); } catch (e2) {}
    }
  }

  if (!cal || !Array.isArray(cal.dias)) {
    return json(502, { error: "La IA no devolvió un calendario en el formato esperado. Probá Regenerar." });
  }

  return json(200, cal);
};
