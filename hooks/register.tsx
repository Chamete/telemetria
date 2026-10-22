import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionCost, SessionRateLimit } from 'claude-code'

import type { TelInferencia, TelLimite, TelMcp, TelMedida } from '../types'

// Telemetría: una franja sobre el prompt con el contexto ocupado y la caché, la
// velocidad y la latencia de la última respuesta, el estado de las herramientas MCP
// y los límites de uso de 5 horas y semanal. Solo muestra datos que da el motor.

const medida = atom({ plugin: 'telemetria', key: 'medida' } as const, {
  tokens: null,
  ventana: 200_000,
  porcentaje: null,
  limites: [],
  coste: null,
} as TelMedida)
const inferencia = atom({ plugin: 'telemetria', key: 'inferencia' } as const, { tps: null, ttft: null, cache: null } as TelInferencia)
const mcp = atom({ plugin: 'telemetria', key: 'mcp' } as const, { estado: 'sin-uso', servidor: '' } as TelMcp)
// Avanza cada 30 s para que las cuentas atrás se redibujen.
const minuto = atom({ plugin: 'telemetria', key: 'minuto' } as const, 0)

// ---------------------------------------------------------------------------
// Datos

const guardarMedida = async (
  $: EngineInterface,
  datos: { context: SessionContextUsage; rateLimits: SessionRateLimit[]; cost?: SessionCost },
) => {
  const limites: TelLimite[] = datos.rateLimits.map(l => ({ tipo: l.kind, usado: l.percentUsed, reinicio: l.resetsAt ?? null }))
  await update($, medida, () => ({
    tokens: datos.context.tokens ?? null,
    ventana: datos.context.window,
    porcentaje: datos.context.percent ?? null,
    limites,
    coste: datos.cost?.usd ?? null,
  }))
}

const limite = (m: TelMedida, tipo: string) => m.limites.find(l => l.tipo === tipo)

// ---------------------------------------------------------------------------
// Formato

const miles = (n: number | null) =>
  n === null ? '—' : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)

const cuentaAtras = (iso: string | null, ahora: number) => {
  if (!iso) return ''
  const ms = Date.parse(iso) - ahora
  if (!Number.isFinite(ms)) return ''
  if (ms <= 0) return 'Resetea ya'
  const min = Math.round(ms / 60_000)
  const d = Math.floor(min / 1440)
  const h = Math.floor((min % 1440) / 60)
  const m = min % 60
  return d > 0 ? `Resetea en ${d}d ${h}h` : h > 0 ? `Resetea en ${h}h ${m}m` : `Resetea en ${m}m`
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

type Vista = {
  ctxPct: number | null
  ctxTexto: string
  ctxUsado: string
  ctxVentana: string
  /** Contexto por encima del umbral: el panel pasa a modo alerta. */
  alerta: boolean
  cache: string
  tps: string
  ttft: string
  mcp: TelMcp
  sesionLibre: number | null
  sesionReinicio: string
  semanaLibre: number | null
  semanaReinicio: string
}

// Por encima de este porcentaje de contexto (750k en una ventana de 1M) se avisa.
const UMBRAL_CONTEXTO = 75

// Porcentaje disponible de un límite, de 0 a 100.
const disponible = (usado: number) => Math.max(0, Math.min(100, Math.round(100 - usado)))

const prepararVista = (m: TelMedida, inf: TelInferencia, estadoMcp: TelMcp, ahora: number): Vista => {
  const sesion = limite(m, 'five_hour')
  const semana = limite(m, 'seven_day')
  const pct = m.porcentaje ?? (m.tokens !== null && m.ventana > 0 ? Math.round((m.tokens / m.ventana) * 100) : null)
  return {
    ctxPct: pct,
    ctxTexto: `${miles(m.tokens)} / ${miles(m.ventana)}`,
    ctxUsado: miles(m.tokens),
    ctxVentana: miles(m.ventana),
    alerta: pct !== null && pct > UMBRAL_CONTEXTO,
    cache: inf.cache === null ? '—' : `${Math.round(inf.cache)}%`,
    tps: inf.tps === null ? '—' : inf.tps.toFixed(1),
    ttft: inf.ttft === null ? '—' : inf.ttft >= 1000 ? `${(inf.ttft / 1000).toFixed(1)}s` : `${Math.round(inf.ttft)}ms`,
    mcp: estadoMcp,
    // Las dos barras son decrecientes: empiezan llenas y se vacían con el uso.
    sesionLibre: sesion ? disponible(sesion.usado) : null,
    sesionReinicio: sesion ? cuentaAtras(sesion.reinicio, ahora) : '',
    semanaLibre: semana ? disponible(semana.usado) : null,
    semanaReinicio: semana ? cuentaAtras(semana.reinicio, ahora) : '',
  }
}

// ---------------------------------------------------------------------------
// Dibujo en SVG (escritorio), calcado de la referencia: panel gris pizarra con borde suave,
// banner ámbar arriba en alerta y tres columnas (contexto · inferencia · límites).

const FUENTE = `font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif"`
const MCP_COLOR = { 'sin-uso': '#6B7280', ok: '#4ADE80', error: '#F87171' } as const
const MCP_TEXTO = { 'sin-uso': 'sin uso', ok: 'OK', error: 'error' } as const
const CIAN = '#22D3EE'
const AMBAR = '#F59E0B'
const C = {
  panel: '#1A2129',
  borde: '#3A4654',
  divisor: '#323C48',
  banner: '#3A2D18',
  bannerLinea: '#5C4521',
  textoAmbar: '#F2A53A',
  pista: { lee: '#12414A', alerta: '#4A3A22' },
  blanco: '#F3F4F6',
  gris: '#9AA6B2',
  grisClaro: '#C7CED6',
  pildora: '#2A323C',
  amarillo: '#FACC15',
  pistaBarra: '#143E52',
} as const
const TEXTO_ALERTA = (pct: number | null) =>
  `Contexto saturado (${pct ?? '—'}%). Ejecuta /compact para resumir y optimizar la sesión.`

const donut = (cx: number, cy: number, r: number, pct: number | null, alerta: boolean) => {
  const color = alerta ? AMBAR : CIAN
  const c = 2 * Math.PI * r
  const lleno = (Math.max(0, Math.min(100, pct ?? 0)) / 100) * c
  return `
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${alerta ? C.pista.alerta : C.pista.lee}" stroke-width="15"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="15"
      stroke-dasharray="${lleno.toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/>
    <text x="${cx}" y="${cy + 9}" text-anchor="middle" font-size="26" font-weight="500" fill="${color}" ${FUENTE}>${pct === null ? '—' : `${pct}%`}</text>`
}

// Barra decreciente: título a la izquierda, cuenta atrás a la derecha, «NN% disponible» dentro.
const barra = (x: number, y: number, w: number, titulo: string, derecha: string, pct: number | null, grad: string) => {
  const lleno = Math.max(0, Math.min(1, (pct ?? 0) / 100)) * w
  const etiqueta = pct === null ? 'sin datos' : `${pct}% disponible`
  const dentro = lleno > 160
  return `
    <text x="${x}" y="${y}" font-size="16" font-weight="600" fill="${C.grisClaro}" ${FUENTE}>${xml(titulo)}</text>
    <text x="${x + w}" y="${y - 4}" text-anchor="end" font-size="15" fill="${C.gris}" ${FUENTE}>${xml(derecha)}</text>
    <rect x="${x}" y="${y + 10}" width="${w}" height="36" rx="10" fill="${C.pistaBarra}"/>
    ${pct === null || lleno < 1 ? '' : `<rect x="${x}" y="${y + 10}" width="${lleno.toFixed(1)}" height="36" rx="10" fill="url(#${grad})"/>`}
    <text x="${dentro ? x + 14 : x + lleno + 12}" y="${y + 34}" font-size="18" font-weight="500" fill="${C.blanco}" ${FUENTE}>${etiqueta}</text>`
}

// Columna 1: dónut; a su lado título, tokens y caché. Mide lo mismo con y sin alerta:
// el aviso solo se añade como banner encima de la caja.
const ALTO_CONTEXTO = 150
const bloqueContexto = (v: Vista, x: number, y: number) => {
  const tx = x + 142
  return `
    ${donut(x + 62, y + 70, 54, v.ctxPct, v.alerta)}
    <text x="${tx}" y="${y + 40}" font-size="17" font-weight="700" letter-spacing="0.3" fill="${v.alerta ? C.textoAmbar : C.grisClaro}" ${FUENTE}>${v.alerta ? 'CONTEXTO ALTO' : 'CONTEXTO'}</text>
    <text x="${tx}" y="${y + 80}" font-size="32" font-weight="500" fill="${C.blanco}" ${FUENTE}>${xml(v.ctxUsado)}<tspan font-size="28" font-weight="400" fill="${C.gris}"> / ${xml(v.ctxVentana)}</tspan></text>
    <rect x="${tx - 2}" y="${y + 96}" width="140" height="32" rx="8" fill="${C.pildora}"/>
    <text x="${tx + 11}" y="${y + 118}" font-size="17" fill="${C.blanco}" ${FUENTE}>Caché: ${xml(v.cache)}</text>`
}

// Columna 2: velocidad grande, TTFT en amarillo y estado MCP, centrados en vertical.
const bloqueInferencia = (v: Vista, x: number, cy: number, enLinea: boolean) =>
  enLinea
    ? `
    <text x="${x}" y="${cy + 7}" font-size="22" font-weight="500" fill="${C.blanco}" ${FUENTE}>${xml(v.tps)} t/s<tspan font-size="17" fill="${C.amarillo}" dx="22">TTFT: ${xml(v.ttft)}</tspan><tspan font-size="17" fill="${MCP_COLOR[v.mcp.estado]}" dx="22">●</tspan><tspan font-size="17" fill="${C.gris}" dx="6">MCP: </tspan><tspan font-size="17" fill="${MCP_COLOR[v.mcp.estado]}">${MCP_TEXTO[v.mcp.estado]}</tspan></text>`
    : `
    <text x="${x}" y="${cy - 22}" font-size="32" font-weight="500" fill="${C.blanco}" ${FUENTE}>${xml(v.tps)} t/s</text>
    <text x="${x}" y="${cy + 12}" font-size="19" fill="${C.amarillo}" ${FUENTE}>TTFT: ${xml(v.ttft)}</text>
    <circle cx="${x + 7}" cy="${cy + 46}" r="7" fill="${MCP_COLOR[v.mcp.estado]}"/>
    <text x="${x + 24}" y="${cy + 53}" font-size="19" fill="${C.gris}" ${FUENTE}>MCP: <tspan fill="${MCP_COLOR[v.mcp.estado]}">${MCP_TEXTO[v.mcp.estado]}</tspan></text>`

// Columna 3: las dos barras, centradas en vertical.
const ALTO_BARRAS = 128
const bloqueBarras = (v: Vista, x: number, y: number, w: number) => `
    ${barra(x, y + 18, w, 'SESIÓN (5h)', v.sesionReinicio, v.sesionLibre, 'g-sesion')}
    ${barra(x, y + 84, w, 'SEMANAL', v.semanaReinicio, v.semanaLibre, 'g-semana')}`

const separadorV = (x: number, y1: number, y2: number) => `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="${C.divisor}" stroke-width="1.5"/>`
const separadorH = (x1: number, x2: number, y: number) => `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${C.divisor}" stroke-width="1.5"/>`

// Unidades de dibujo por columna de la franja. El SVG se estira hasta llenar la franja
// (el mismo ancho que el cuadro de texto), así que esto solo decide el diseño y el tamaño
// relativo de la letra: con ~80 columnas (lo habitual en la app) salen las tres columnas.
const UNIDADES_POR_COLUMNA = 15.5

// Como en la referencia, las dos primeras columnas miden lo que su contenido y la de
// los límites se queda con el resto.
const ANCHO_COL_CONTEXTO = 400
const ANCHO_COL_INFERENCIA = 250

/**
 * - ancho suficiente: tres columnas, contexto · inferencia · límites (la referencia);
 * - ≥ 600: contexto e inferencia arriba, límites debajo a todo el ancho;
 * - estrecho: todo apilado, inferencia en una línea.
 */
const svgFranja = (v: Vista, columnas: number) => {
  const W = Math.max(520, Math.min(2600, Math.round(columnas * UNIDADES_POR_COLUMNA)))
  const bh = v.alerta ? 60 : 0 // alto del banner
  const m = 30
  const hCtx = ALTO_CONTEXTO
  let cuerpo = ''
  let alto = 0

  if (W >= m + ANCHO_COL_CONTEXTO + ANCHO_COL_INFERENCIA + 420) {
    const x2 = m + ANCHO_COL_CONTEXTO
    const x3 = x2 + ANCHO_COL_INFERENCIA
    const y = bh + 22
    const h = Math.max(hCtx, ALTO_BARRAS)
    cuerpo = `
      ${bloqueContexto(v, m, y)}
      ${separadorV(x2, y, y + h)}
      ${bloqueInferencia(v, x2 + 32, y + h / 2, false)}
      ${separadorV(x3, y, y + h)}
      ${bloqueBarras(v, x3 + 30, y + (h - ALTO_BARRAS) / 2, W - x3 - 30 - m)}`
    alto = y + h + 24
  } else if (W >= 600) {
    const x2 = Math.max(m + ANCHO_COL_CONTEXTO, Math.round(W * 0.58))
    const y = bh + 22
    const yb = y + hCtx + 22
    cuerpo = `
      ${bloqueContexto(v, m, y)}
      ${separadorV(x2, y, y + hCtx)}
      ${bloqueInferencia(v, x2 + 32, y + hCtx / 2, false)}
      ${separadorH(m, W - m, yb - 8)}
      ${bloqueBarras(v, m, yb, W - 2 * m)}`
    alto = yb + ALTO_BARRAS + 14
  } else {
    const y = bh + 22
    const yi = y + hCtx + 18
    const yb = yi + 46
    cuerpo = `
      ${bloqueContexto(v, m, y)}
      ${separadorH(m, W - m, yi - 6)}
      ${bloqueInferencia(v, m, yi + 18, true)}
      ${separadorH(m, W - m, yb - 4)}
      ${bloqueBarras(v, m, yb, W - 2 * m)}`
    alto = yb + ALTO_BARRAS + 14
  }

  const textoBanner = W >= 1100 ? TEXTO_ALERTA(v.ctxPct) : `Contexto saturado (${v.ctxPct ?? '—'}%). Ejecuta /compact.`
  const banner = v.alerta
    ? `<g clip-path="url(#panel)">
        <rect x="0" y="0" width="${W}" height="${bh}" fill="${C.banner}"/>
        <line x1="0" y1="${bh}" x2="${W}" y2="${bh}" stroke="${C.bannerLinea}" stroke-width="1.5"/>
      </g>
      <text x="${m}" y="${bh / 2 + 8}" font-size="22" font-weight="500" fill="${C.textoAmbar}" ${FUENTE}>( ! )<tspan dx="16">${xml(textoBanner)}</tspan></text>`
    : ''

  // `width` grande: el panel se ajusta al ancho del hueco (como el cuadro de texto) y
  // conserva la proporción del `viewBox`.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W * 4}" height="${alto * 4}" viewBox="0 0 ${W} ${alto}">
  <defs>
    <linearGradient id="g-sesion" x1="0" x2="1"><stop offset="0" stop-color="#1993A4"/><stop offset="1" stop-color="#3CC9B4"/></linearGradient>
    <linearGradient id="g-semana" x1="0" x2="1"><stop offset="0" stop-color="#1F5E9C"/><stop offset="1" stop-color="#2BB3AE"/></linearGradient>
    <clipPath id="panel"><rect x="1" y="1" width="${W - 2}" height="${alto - 2}" rx="22"/></clipPath>
  </defs>
  <rect x="1" y="1" width="${W - 2}" height="${alto - 2}" rx="22" fill="${C.panel}" stroke="${C.borde}" stroke-width="2"/>
  ${banner}
  ${cuerpo}
</svg>`
}

const textoAlternativo = (v: Vista) =>
  [
    v.alerta ? TEXTO_ALERTA(v.ctxPct) : '',
    `Contexto ${v.ctxPct ?? '—'}% (${v.ctxTexto})`,
    `caché ${v.cache}`,
    `${v.tps} t/s`,
    `TTFT ${v.ttft}`,
    `MCP ${MCP_TEXTO[v.mcp.estado]}`,
    `sesión ${v.sesionLibre ?? '—'}% disponible ${v.sesionReinicio}`,
    `semanal ${v.semanaLibre ?? '—'}% disponible ${v.semanaReinicio}`,
  ]
    .filter(Boolean)
    .join(' · ')

// Escribe /compact en el prompt para que la persona lo confirme con Enter: compactar
// resume la conversación y no se deshace, así que no se ejecuta solo. Si ya hay un
// borrador escrito, no se pisa.
const prepararCompact = async ($: EngineInterface) => {
  const borrador = await $.prompt.read().catch(() => ({ text: '' }))
  if (borrador.text.trim() && borrador.text.trim() !== '/compact') {
    $.ui.toast('Vacía el prompt y vuelve a pulsar para escribir /compact.')
    return
  }
  const r = await $.prompt.fill({ text: '/compact', mode: 'replace' })
  $.ui.toast(r.isFilled ? '/compact listo en el prompt: pulsa Enter para compactar.' : 'No se pudo escribir /compact en el prompt.')
}

// Barra de texto para la terminal: ▰▰▰▱▱
const barraTexto = (pct: number | null, ancho: number) => {
  if (pct === null) return '─'.repeat(ancho)
  const llenos = Math.round((Math.max(0, Math.min(100, pct)) / 100) * ancho)
  return '▰'.repeat(llenos) + '▱'.repeat(ancho - llenos)
}
const donutTexto = (pct: number | null) => (pct === null ? '○' : ['○', '◔', '◑', '◕', '●'][Math.min(4, Math.round(pct / 25))] ?? '○')

// ---------------------------------------------------------------------------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await guardarMedida($, await $.session.usage()).catch(() => undefined)
    $.clock.every(30_000, () => void update($, minuto, n => n + 1))
    return r
  })

  // El motor avisa cuando cambian el contexto, los límites o el coste.
  on('session.measure', async ($, e, next) => {
    await guardarMedida($, e)
    return next(e)
  })

  // Velocidad, latencia y caché de cada respuesta del hilo principal.
  on('turn.step', async function* ($, e, next) {
    const principal = e.agentId === undefined
    const inicio = principal ? await $.clock.now() : 0
    // Primer trozo de cualquier tipo (también los del motor): el razonamiento que no se
    // muestra no llega como texto, y medir desde el primer texto visible dejaba fuera su
    // generación e inflaba los t/s.
    let primero = 0
    const flujo = next(e)
    for await (const trozo of flujo) {
      if (principal && !primero) primero = await $.clock.now()
      yield trozo
    }
    const res = await flujo.result
    if (principal && res.usage) {
      const fin = await $.clock.now()
      const u = res.usage
      const entrada = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
      const generando = primero ? (fin - primero) / 1000 : 0
      await update($, inferencia, previa => ({
        tps: generando > 0.2 && u.output_tokens > 0 ? u.output_tokens / generando : previa.tps,
        ttft: primero ? primero - inicio : previa.ttft,
        cache: entrada > 0 ? (u.cache_read_input_tokens / entrada) * 100 : previa.cache,
      }))
    }
    return res
  })

  // Estado MCP: el resultado de la última herramienta MCP que se usó.
  on('tool.call', async ($, e, next) => {
    const nombre = String(e.tool)
    if (!nombre.startsWith('mcp__')) return next(e)
    const res = await next(e)
    const fallo = ('deny' in res && Boolean(res.deny)) || res.isError === true
    await update($, mcp, () => ({ estado: fallo ? 'error' : 'ok', servidor: nombre.split('__')[1] ?? '' }))
    return res
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    await read($, minuto)
    const v = prepararVista(await read($, medida), await read($, inferencia), await read($, mcp), await $.clock.now())
    const tabla = $.ui.resolve(e)

    const { Box, Text, Button } = tabla
    const avisoCompact = v.alerta ? (
      <Button key="compact" label="Escribir /compact en el prompt" variant="primary" onPress={() => void prepararCompact($)} />
    ) : null

    if (e.surface === 'desktop' && 'Svg' in tabla) {
      const panel = <tabla.Svg source={svgFranja(v, e.props.bodyColumns)} alt={textoAlternativo(v)} />
      return avisoCompact ? (
        <Box flexDirection="column" gap="xs">
          {panel}
          {avisoCompact}
        </Box>
      ) : (
        panel
      )
    }

    const col = e.props.bodyColumns
    const anchoBarra = col >= 120 ? 12 : 6
    const colorCtx = v.alerta ? AMBAR : CIAN
    return (
      <Box flexDirection="column">
        {v.alerta && (
          <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
            <Text color={AMBAR} weight="bold">
              (!) {TEXTO_ALERTA(v.ctxPct)}
            </Text>
            {avisoCompact}
          </Box>
        )}
        <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
          <Text>
            <Text color={colorCtx}>
              {donutTexto(v.ctxPct)} {v.ctxPct ?? '—'}%
            </Text>
            <Text color={v.alerta ? AMBAR : undefined} dimColor={!v.alerta}>
              {v.alerta ? ' ⚠ ctx alto ' : ' ctx '}
            </Text>
            {v.ctxTexto}
            <Text dimColor> · caché </Text>
            {v.cache}
          </Text>
          <Text>
            <Text weight="bold">{v.tps}</Text>
            <Text dimColor> t/s · TTFT </Text>
            <Text color="#FBBF24">{v.ttft}</Text>
            <Text dimColor> · </Text>
            <Text color={MCP_COLOR[v.mcp.estado]}>● MCP {MCP_TEXTO[v.mcp.estado]}</Text>
          </Text>
          <Text>
            <Text dimColor>5h </Text>
            <Text color="#2DD4BF">{barraTexto(v.sesionLibre, anchoBarra)}</Text> {v.sesionLibre ?? '—'}% disponible
            <Text dimColor>{v.sesionReinicio ? ` (${v.sesionReinicio.replace('Resetea en ', '')})` : ''}</Text>
          </Text>
          <Text>
            <Text dimColor>sem </Text>
            <Text color="#38BDF8">{barraTexto(v.semanaLibre, anchoBarra)}</Text> {v.semanaLibre ?? '—'}% disponible
            <Text dimColor>{v.semanaReinicio ? ` (${v.semanaReinicio.replace('Resetea en ', '')})` : ''}</Text>
          </Text>
        </Box>
      </Box>
    )
  })
}
