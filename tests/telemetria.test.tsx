import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const FRANJA = {
  plugin: 'telemetria',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 150, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

const AHORA = Date.parse('2026-10-22T18:00:00Z')

const preparar = (on: On, contexto = { tokens: 84_000, window: 200_000, percent: 42 }) => {
  mock.store(on)
  const reloj = mock.clock(on, { now: AHORA })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: {
      startedAt: AHORA,
      context: contexto,
      rateLimits: [
        { kind: 'five_hour', percentUsed: 32, resetsAt: '2026-10-22T19:40:00Z' },
        { kind: 'seven_day', percentUsed: 82, resetsAt: '2026-10-25T09:00:00Z' },
      ],
      cost: { usd: 1.2 },
    },
  }))
  on('tool.call', () => ({ result: {} }))
  return reloj
}

test('dibuja contexto, límites y estado MCP con datos reales del motor', async ($, on) => {
  preparar(on)
  await $.session.start({ cwd: '/p', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'mcp__github__search', query: 'x' } as never)

  const ui = await $.ui.mount({ ...FRANJA, surface: 'desktop' })
  const svg = await ui.find({ type: 'Svg' })
  const fuente = String(svg?.props.source)
  expect(fuente).toContain('42%')
  expect(fuente).toContain('84k')
  expect(fuente).toContain('/ 200k')
  expect(fuente).toContain('68% disponible')
  // 82 % usado en la semana → 18 % disponible, y la barra mide justo eso
  expect(fuente).toContain('18% disponible')
  expect(fuente).toContain('Resetea en 1h 40m')
  expect(fuente).toContain('>OK<')
  await ui.unmount()

  // Responsivo: cuanto más estrecha la franja, más alto el panel (se apila).
  const altos: number[] = []
  for (const bodyColumns of [120, 50, 30]) {
    const vista = await $.ui.mount({ ...FRANJA, surface: 'desktop', props: { ...FRANJA.props, bodyColumns } })
    const svgN = String((await vista.find({ type: 'Svg' }))?.props.source)
    expect(svgN).toContain('SESIÓN (5h)')
    altos.push(Number(/height="(\d+)"/.exec(svgN)?.[1]))
    await vista.unmount()
  }
  expect(altos[0]).toBeLessThan(altos[1] ?? 0)
  expect(altos[1]).toBeLessThan(altos[2] ?? 0)

  const terminal = await $.ui.mount({ ...FRANJA, surface: 'terminal' })
  expect(await terminal.find({ type: 'Text', text: /68% disponible/ })).toBeDefined()
  await terminal.unmount()
})

test('mide TTFT, tokens por segundo y caché de una respuesta', async ($, on) => {
  const reloj = preparar(on)
  // La respuesta simulada: el primer trozo llega a los 400 ms y la respuesta
  // termina 2 s después con 128 tokens generados; 90 de 100 de entrada, de caché.
  on('turn.step', async function* () {
    await reloj.advance(400)
    yield { kind: 'text', index: 0, text: 'Hola' }
    await reloj.advance(2000)
    return {
      turnId: 't1',
      index: 0,
      answer: 'Hola',
      toolUses: [],
      stopReason: 'end_turn',
      usage: { model: 'm', input_tokens: 4, cache_read_input_tokens: 90, cache_creation_input_tokens: 6, output_tokens: 128 },
    }
  })
  await $.session.start({ cwd: '/p', surface: 'desktop', isInteractive: true })

  const flujo = $.turn.step({ turnId: 't1', index: 0, model: 'm', messageCount: 1 })
  for await (const _ of flujo) {
    // se consumen los trozos como hace el motor
  }
  await flujo.result

  const ui = await $.ui.mount({ ...FRANJA, surface: 'desktop' })
  const fuente = String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(fuente).toContain('64.0')
  expect(fuente).toContain('400ms')
  expect(fuente).toContain('Caché: 90%')
  await ui.unmount()
})

test('con el contexto alto: alerta ámbar y banner, sin botones', async ($, on) => {
  preparar(on, { tokens: 780_000, window: 1_000_000, percent: 78 })
  await $.session.start({ cwd: '/p', surface: 'desktop', isInteractive: true })

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...FRANJA, surface })
    if (surface === 'desktop') {
      const fuente = String((await ui.find({ type: 'Svg' }))?.props.source)
      expect(fuente).toContain('Contexto saturado (78%). Ejecuta /compact para resumir y optimizar la sesión.')
      expect(fuente).toContain('CONTEXTO ALTO')
      expect(fuente).toContain('#F59E0B')
      expect(fuente).toContain('780k')
      expect(fuente).toContain('/ 1.0M')
    } else {
      expect(await ui.find({ type: 'Text', text: /Contexto saturado \(78%\)/ })).toBeDefined()
    }
    expect(await ui.find({ type: 'Button' })).toBeUndefined()
    await ui.unmount()
  }
})

test('por debajo del umbral no hay alerta', async ($, on) => {
  preparar(on)
  await $.session.start({ cwd: '/p', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...FRANJA, surface: 'desktop' })
  const fuente = String((await ui.find({ type: 'Svg' }))?.props.source)
  expect(fuente).not.toContain('Contexto saturado')
  expect(fuente).toContain('#22D3EE')
  await ui.unmount()
})

test('con el ancho habitual de la app (~80 columnas) salen las tres columnas de la referencia', async ($, on) => {
  preparar(on)
  await $.session.start({ cwd: '/p', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...FRANJA, surface: 'desktop', props: { ...FRANJA.props, bodyColumns: 80 } })
  const fuente = String((await ui.find({ type: 'Svg' }))?.props.source)
  // La tercera columna (barras) empieza tras contexto (400) e inferencia (250).
  expect(fuente).toContain('x="710" y="')
  await ui.unmount()
})

test('la alerta solo añade el banner: la caja de datos mide lo mismo', async ($, on) => {
  // El mismo objeto que lee el motor simulado: se cambia entre una medida y otra.
  const contexto = { tokens: 84_000, window: 200_000, percent: 42 }
  preparar(on, contexto)
  const altoActual = async () => {
    await $.session.start({ cwd: '/p', surface: 'desktop', isInteractive: true })
    const ui = await $.ui.mount({ ...FRANJA, surface: 'desktop' })
    const fuente = String((await ui.find({ type: 'Svg' }))?.props.source)
    await ui.unmount()
    expect(fuente).not.toContain('para liberar')
    return Number(/viewBox="0 0 \d+ (\d+)"/.exec(fuente)?.[1])
  }
  const normal = await altoActual()
  Object.assign(contexto, { tokens: 780_000, window: 1_000_000, percent: 78 })
  const alerta = await altoActual()
  // 60 unidades: el alto del banner y nada más
  expect(alerta - normal).toBe(60)
})

test('el umbral es el 70 %, incluido: 69 % no avisa; 70 % y 75 % sí', async ($, on) => {
  const contexto = { tokens: 0, window: 1_000_000, percent: 0 }
  preparar(on, contexto)
  const hayAlerta = async (percent: number) => {
    Object.assign(contexto, { tokens: percent * 10_000, percent })
    await $.session.start({ cwd: '/p', surface: 'desktop', isInteractive: true })
    const ui = await $.ui.mount({ ...FRANJA, surface: 'desktop' })
    const fuente = String((await ui.find({ type: 'Svg' }))?.props.source)
    await ui.unmount()
    return fuente.includes('Contexto saturado')
  }
  expect(await hayAlerta(69)).toBe(false)
  expect(await hayAlerta(70)).toBe(true)
  expect(await hayAlerta(75)).toBe(true)
})
