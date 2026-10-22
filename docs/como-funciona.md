# Cómo funciona la Telemetría

Guía interna del mod para quien quiera entenderlo o modificarlo.

## Piezas

| Archivo | Papel |
|---|---|
| `hooks/register.tsx` | El *hooks module*: recoge los datos, dibuja la franja y escribe `/compact`. |
| `types/index.d.ts` | Contrato de los valores que el mod guarda en `$.state`. |
| `tests/telemetria.test.tsx` | Pruebas con el kit `claude-code/testing`. |

## De dónde sale cada dato

| Evento | Qué hace el mod |
|---|---|
| `session.start` | Lee `$.session.usage()` (contexto, límites y coste) y arranca un reloj de 30 s para las cuentas atrás. |
| `session.measure` | El motor avisa cuando cambian el contexto, los límites o el coste; el mod guarda la nueva medida. |
| `turn.step` | En cada respuesta del hilo principal toma la hora de la petición, la del primer trozo recibido y la del final. Con el `usage` de la respuesta calcula TTFT, t/s y caché. |
| `tool.call` (`mcp__*`) | Anota si la última herramienta MCP terminó bien o con error. Lleva un `.catch` que deja pasar la llamada si algo falla. |
| `ui.render` (`AbovePrompt`) | Dibuja la franja encima del cuadro de texto. |

Cálculos:

- **Contexto:** `tokens / ventana`, tal como lo da Claude Code (el mismo dato que la línea de estado).
- **TTFT:** desde que se envía la petición hasta el primer trozo de la respuesta, de cualquier tipo.
- **t/s:** `output_tokens / (fin − primer trozo)`. Se mide desde el primer trozo de cualquier tipo porque el razonamiento oculto no llega como texto; medir desde el primer texto visible inflaba la cifra.
- **Caché:** `cache_read_input_tokens / (input + cache_read + cache_creation)`.
- **Límites:** `100 − percentUsed` de las ventanas `five_hour` y `seven_day`, con la cuenta atrás hasta `resetsAt`.

## Dibujo

- **Escritorio:** un SVG generado en cada render, que se estira hasta llenar la franja y conserva la proporción.
  - El diseño se elige con el ancho de la franja en columnas (`bodyColumns × 15,5` unidades de dibujo).
  - Las dos primeras columnas miden lo que su contenido (400 y 250 unidades) y la de límites ocupa el resto.
  - Por debajo de ~70 columnas, las barras pasan debajo; por debajo de ~40, todo se apila.
- **Terminal, VS Code y móvil:** una línea de `Text` con colores y barras `▰▱`.
- **Modo alerta:** cuando el contexto supera `UMBRAL_CONTEXTO` (75 %).
  - Cambia el color del dónut a ámbar y añade el banner encima de la caja; el resto del panel mide lo mismo que sin alerta.
  - Debajo del gráfico, un `Button` llama a `$.prompt.fill` con `/compact`. El SVG es una imagen y no admite clics.

## Colores

| Elemento | Color |
|---|---|
| Panel / borde / separadores | `#1A2129` / `#3A4654` / `#323C48` |
| Banner de alerta | fondo `#3A2D18`, texto `#F2A53A` |
| Dónut normal / alerta | `#22D3EE` sobre `#12414A` / `#F59E0B` sobre `#4A3A22` |
| TTFT | `#FACC15` |
| MCP OK / error | `#4ADE80` / `#F87171` |
| Barra de sesión | `#1993A4` → `#3CC9B4` sobre `#143E52` |
| Barra semanal | `#1F5E9C` → `#2BB3AE` |

## Ajustes rápidos

En `hooks/register.tsx`:

```ts
const UMBRAL_CONTEXTO = 75        // % de contexto a partir del cual se avisa
const UNIDADES_POR_COLUMNA = 15.5 // tamaño relativo del dibujo y cambio de diseño
const ANCHO_COL_CONTEXTO = 400
const ANCHO_COL_INFERENCIA = 250
```
