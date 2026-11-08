# Assetly Finance — Investigación de mercado

Assetly Finance es una aplicación web de investigación de mercado para consultar cotizaciones, analizar fundamentos y noticias con fuentes, explorar una orientación educativa transparente y llevar una cartera virtual. Incluye watchlist, comparador, objetivos, diario de investigación y exportación de datos. Usa Node.js y Express en el backend, y HTML/CSS/JavaScript con Chart.js en el frontend.

**Descripción corta para GitHub:** Dashboard de investigación de mercado con cotizaciones, fundamentos, noticias con fuentes, orientación educativa explicable y cartera virtual. No ejecuta operaciones reales ni sustituye asesoramiento financiero.

> **Uso educativo:** la orientación automática combina reglas descriptivas sobre precio, fundamentos y titulares; no es personalizada, no predice rendimientos ni constituye asesoramiento financiero. No operes dinero real basándote únicamente en este proyecto.

## Requisitos y arranque

- Node.js 22 o posterior (requisito de `yahoo-finance2` v4).
- npm.

Desde esta carpeta (`AI Finance/IP`):

```bash
npm ci
npm start
```

Abrí `http://localhost:3000`. Para reinicio automático al editar:

```bash
npm run dev
```

## Funcionalidad

- Búsqueda de símbolos como `AAPL`, `MSFT`, `GGAL.BA` o índices como `^GSPC`.
- Búsqueda con filtro por tipo de activo y watchlist ordenable por símbolo o variación.
- Portada con cotizaciones de referencia para AAPL, MSFT, NVDA, GOOGL y SPY; al seleccionar una, se abre su análisis.
- Periodos de 1, 3 o 6 meses y 1 año; intervalo diario o por hora.
- Último cierre disponible, fecha/hora, mercado y moneda cuando Yahoo Finance los informa.
- Variación calculada entre los dos últimos cierres disponibles del intervalo elegido.
- Gráfico histórico y noticias recientes con editor/fuente, fecha, enlace y puntuación de sentimiento cuando esos datos están disponibles.
- Umbrales configurables para la señal educativa de sentimiento.
- Estados separados para datos disponibles, ausencia de noticias válidas, carga y errores.
- Ficha de calidad del dato con fuente, hora, moneda, mercado, demora informada, periodo de variación y estado de noticias.
- Resumen determinista del periodo seleccionado: primer/último cierre, variación de precio, máximo y mínimo de cierre y cantidad de observaciones.
- Calendario del activo con fechas de resultados, llamadas y dividendos que informa Yahoo Finance; las fechas estimadas se identifican y la falta de eventos se distingue del fallo de consulta.
- Contexto temporal de la variación con titulares cuyo medio y dominio del enlace son compatibles; la interfaz aclara que una coincidencia temporal no demuestra causalidad.
- Exportación CSV del análisis (cierres, métricas, noticias y eventos) y JSON de los datos de la cuenta (favoritos, análisis guardados y cartera virtual).
- Caché persistente del último precio válido (hasta siete días). Ante una falla se informa que el dato es anterior, conservando fuente y hora; nunca se etiqueta como actual.
- Preferencias de accesibilidad y visualización: tamaño de texto, contraste, animaciones y tema. Se guardan en este navegador y, al iniciar sesión, también en la cuenta.
- Fundamentos reportados por el proveedor (valoración, márgenes, crecimiento, rentabilidad, deuda y flujo de caja); cada campo sin cobertura se muestra como no disponible.
- Orientación educativa de **COMPRAR / MANTENER / VENDER** con metodología visible: tendencia del periodo, métricas fundamentales y tono de titulares. Requiere al menos dos grupos de evidencia; sentimientos usa tres o más titulares. Los umbrales son heurísticos, no una estrategia validada ni asesoramiento personalizado.
- Enlace a la ficha oficial de Nasdaq, NYSE o BYMA cuando se puede identificar la bolsa. El usuario puede contrastar allí el precio; la web no extrae automáticamente datos de esas fichas.
- Calidad de muestra histórica: cantidad de cierres, fechas cubiertas e intervalo máximo observado, con una nota de que fines de semana y feriados afectan los huecos.
- Cartera virtual con historial de compras y ventas simuladas al último cierre, costo promedio, P/L realizado y no realizado y concentración por moneda. Sin comisiones, impuestos ni dividendos.
- Objetivos personales que comparan su monto con el valor disponible de tenencias de la misma moneda; no se hace conversión cambiaria.
- Comparador de hasta cuatro símbolos y diario de investigación con notas fechadas y captura opcional del precio visto.
- Escenarios aritméticos hipotéticos acotados entre -90% y +300%; no son pronósticos ni recomendaciones.
- Exportación JSON de favoritos, análisis, operaciones, tenencias, objetivos, diario y preferencias.
- Diseño adaptable a pantallas grandes y móviles.

### Respaldo de cotizaciones y degradación

Yahoo Finance es el proveedor principal. La app guarda las cotizaciones válidas en `DATA_DIR/market-cache.json`, fuera de `public/`. Si el proveedor no responde, identifica cualquier valor servido desde la caché como “último dato disponible / no actualizado”, con la hora original, y limita esa recuperación a siete días.

Hay un adaptador opcional para Twelve Data. Para habilitarlo, agregá una clave propia en `.env` como `TWELVE_DATA_API_KEY=...` y reiniciá el servidor. No se activa ni genera llamadas si la variable está vacía. La disponibilidad, retraso y costo dependen del plan de Twelve Data; la app no crea una cuenta ni contrata un servicio por vos. Antes de mostrar una cotización alternativa valida símbolo, moneda, mercado, hora y clase de precio; si faltan metadatos o no coinciden con una referencia reciente, la rechaza. El campo `datetime` está expresado en hora local y `timestamp` puede indicar la apertura de la vela; por eso usamos `last_quote_at` (marca Unix de la última vela de un minuto) y rechazamos el respaldo si no viene. Ver [documentación oficial de cotizaciones de Twelve Data](https://twelvedata.com/docs/market-data/quote).

Las secciones se degradan por separado: la lista de favoritos y los análisis guardados siguen accesibles aunque falle una cotización; si falla la consulta de noticias, el sentimiento se omite y se muestra su estado. Si la serie histórica completa falla, el análisis nuevo puede no generarse, pero las capturas guardadas permanecen disponibles.

Los titulares provienen del proveedor y no se generan en Assetly Finance. Se requiere un medio identificable y un enlace HTTPS del medio o una página de artículo de Yahoo Finance que atribuya el editor. La atribución facilita la trazabilidad, pero el usuario debe abrir el artículo para contrastar su contenido. Si no hay titulares que pasen los filtros, se marca “sin noticias válidas”; un fallo de consulta se informa por separado.

## Cómo se calcula

VADER puntúa el texto de cada titular en una escala de -1 a +1. Se promedian los titulares válidos:

Para calcular el sentimiento, la app conserva titulares que mencionan el símbolo o el nombre de la empresa, y descarta cobertura general que Yahoo haya asociado incidentalmente al ticker. La búsqueda y la relevancia dependen de los metadatos que provea Yahoo.

- promedio mayor al umbral de compra → `COMPRA`;
- promedio menor al umbral de venta → `VENTA`;
- cualquier otro promedio → `MANTENER`;
- sin titulares con texto → `SIN DATOS`, sin generar una señal.

VADER es un analizador léxico generalista y funciona mejor con inglés. El tono textual no equivale al impacto esperado de una noticia sobre el precio. El backend normaliza entradas y no entrega errores internos del proveedor al navegador.

## Backtest de sentimiento histórico

Yahoo Finance entrega noticias recientes en esta integración, pero no un archivo histórico de titulares y sentimiento. Por eso no se debe reconstruir el pasado mezclando titulares actuales con precios anteriores. El script disponible prueba datos de sentimiento fechados que ya tengas archivados:

```csv
fecha,cierre,sentimiento
2026-01-05,100.25,0.62
2026-01-06,101.10,-0.18
2026-01-07,99.80,-0.71
```

Guardá el CSV fuera del repositorio (o en una carpeta local ignorada) y ejecutá:

```bash
npm run backtest -- ./ruta/al/historial.csv --buy 0.5 --sell -0.5 --cost-bps 5
```

La simulación es **long/cash**: mantiene exposición después de `COMPRA`; queda en efectivo para `VENTA` o `MANTENER`. Usa el sentimiento de una fila para el cambio de cierre a cierre siguiente, compara con comprar y mantener, cobra costos por cambios de posición y reporta retorno, drawdown, operaciones y periodos invertidos. La última fila no produce un retorno porque no existe una observación posterior.

El resultado depende por completo de que el CSV contenga sentimiento realmente observado en esas fechas, con hora de disponibilidad compatible con el cierre. No incluye impuestos, spread, liquidez, dividendos, ejecución intraperiodo ni ajustes por eventos corporativos. Un backtest no garantiza rendimientos futuros.

## API local

- `GET /api/health` — estado básico del proceso.
- `GET /api/config` — capacidades disponibles.
- `GET /api/market-highlights` — cotizaciones de portada, con caché de 30 segundos.
- `GET /api/search-symbols?q=AAPL` — búsqueda de activos con metadatos para filtros.
- `GET /api/analyze?ticker=AAPL&periodo=3mo&intervalo=1d&umbralCompra=0.5&umbralVenta=-0.5` — análisis.
- El análisis incluye resumen del periodo, noticias coincidentes en tiempo con la variación y el calendario de eventos disponible para el símbolo.
- `GET /api/quote?ticker=AAPL` — cotización del proveedor, limitada a 60 solicitudes/minuto por IP.
- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` — cuentas y sesión.
- `GET /api/portfolio`, `POST /api/portfolio/buy`, `POST /api/portfolio/sell`, `DELETE /api/portfolio/:id` — cartera virtual autenticada con historial.
- `GET/POST /api/goals`, `DELETE /api/goals/:id`, `GET/POST /api/journal`, `DELETE /api/journal/:id` — objetivos y diario privado.
- `GET /api/fundamentals?ticker=AAPL`, `GET /api/compare?tickers=AAPL,MSFT` — ficha fundamental y comparación pública.
- `GET /api/watchlist` — lista de favoritos con precio, contexto y estado de actualización.
- `GET/POST /api/favorites`, `DELETE /api/favorites/:ticker`, `GET/POST /api/saved-analyses`, `DELETE /api/saved-analyses/:id` — favoritos y snapshots privados.
- `PUT /api/settings/whatsapp`, `PUT /api/settings/preferences`, `POST /api/whatsapp-alert` — preferencias y alerta autenticadas.

La API de análisis limita a 30 consultas por minuto por IP. Los límites en memoria ayudan para una app personal de una sola instancia; para un servicio público con varias instancias habría que usar un limitador compartido y límites de infraestructura.

## Cuentas, cartera virtual y WhatsApp

Las consultas de mercado son públicas. Crear una cuenta con correo y contraseña habilita la cartera virtual, objetivos, diario y ajustes/alertas de WhatsApp. Las contraseñas se guardan con scrypt; la cookie de sesión es HttpOnly y SameSite Strict. Los datos privados se guardan en `DATA_DIR/users.json`, fuera de los archivos públicos. La cartera es simulada: compra y vende usando el último cierre histórico disponible, sin dinero real ni integración con broker. La rentabilidad no contempla comisiones, impuestos ni dividendos. Los precios de valoración pueden no estar disponibles si falla el proveedor, y cada posición informa la fecha de su cotización.

Las alertas configurables para móvil quedan fuera de esta versión web según el alcance acordado. WhatsApp conserva su flujo manual: Assetly Finance abre el enlace preparado y el usuario confirma el envío.

Cada cuenta tiene teléfono y plantilla de mensaje propios. La plantilla permite `{ticker}`, `{senal}`, `{precio}`, `{moneda}`, `{fecha}` y `{sentimiento}`. El botón crea un enlace `wa.me` a la conversación con el mensaje ya escrito. WhatsApp abre el chat, pero la persona debe tocar Enviar; no hay envío automático ni costo de proveedor en esta integración. El número tiene que tener una cuenta de WhatsApp activa. El formato se normaliza quitando espacios y signos; esto no permite consultar si el número está registrado en WhatsApp.

El precio se refresca cada 30 segundos mientras el resumen está abierto. La fuente puede entregar cotizaciones de mercado en tiempo real, retrasadas o el último dato de sesión, según mercado y símbolo. La app muestra el estado, la hora del dato y el retraso informado por la fuente cuando está disponible. El gráfico conserva la serie histórica seleccionada.

El archivo `.env` local de este workspace precarga el número facilitado para nuevas cuentas. Es un archivo ignorado por Git; se puede editar el teléfono dentro de la app.

## Despliegue

Ejecutá `npm start` con Node.js 22 o superior. En el host configurá `NODE_ENV=production`, HTTPS y un `DATA_DIR` montado en almacenamiento persistente con permisos privados. Este MVP está pensado para una instancia única: las sesiones viven en memoria y se cierran al reiniciar; para múltiples instancias, se debe usar un almacén compartido para sesiones y usuarios. Antes de abrir el registro al público, añadí verificación de correo y recuperación de contraseña.

## Pruebas

```bash
npm test
```

Las pruebas cubren validación, límites de señal, datos incompletos, respuestas de API simuladas y cálculos/validaciones del backtest. La consulta de mercado depende de la disponibilidad de Yahoo Finance; el enlace de WhatsApp requiere que el usuario tenga WhatsApp disponible.

## Estructura

```text
server.js             API Express y configuración segura
lib/validation.js     validación de parámetros y teléfonos
lib/analysis.js       normalización de cotizaciones, noticias y métricas
lib/decisionLogic.js  reglas configurables de señal
lib/sentiment.js      puntuación de titulares con VADER
lib/backtest.js       simulación histórica reproducible
scripts/backtest.js   CLI para historial CSV
public/               interfaz del dashboard
test/                 pruebas con node:test
```

## Fuentes y límites

Yahoo Finance se consume mediante `yahoo-finance2`, una librería comunitaria sin garantía de API pública estable. El calendario de resultados y dividendos es el calendario que informa ese proveedor, no un calendario exhaustivo de todos los hechos que puedan mover un activo; la persona debe confirmar fechas con relaciones con inversores. Chart.js se carga desde jsDelivr y las tipografías desde Google Fonts; la interfaz conserva estructura y estilos si no cargan, aunque el gráfico requiere Chart.js. La app no ejecuta operaciones financieras reales. El almacenamiento JSON local requiere respaldo y volumen persistente al desplegar.
