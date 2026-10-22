/** Un límite de uso de la cuenta, tal como lo informa la API. */
export type TelLimite = { tipo: string; usado: number; reinicio: string | null }

/** Lo que mide la sesión: contexto, límites y coste. */
export type TelMedida = {
  tokens: number | null
  ventana: number
  porcentaje: number | null
  limites: TelLimite[]
  coste: number | null
}

/** La última respuesta del modelo en el hilo principal. */
export type TelInferencia = {
  /** Tokens de salida por segundo, desde el primer trozo hasta el final. */
  tps: number | null
  /** Milisegundos hasta el primer trozo de la respuesta. */
  ttft: number | null
  /** Porcentaje de la entrada que sirvió la caché. */
  cache: number | null
}

/** Resultado de la última llamada a una herramienta MCP. */
export type TelMcp = { estado: 'sin-uso' | 'ok' | 'error'; servidor: string }

declare module 'claude-code' {
  interface PluginState {
    telemetria: {
      medida: TelMedida
      inferencia: TelInferencia
      mcp: TelMcp
      minuto: number
    }
  }
}
