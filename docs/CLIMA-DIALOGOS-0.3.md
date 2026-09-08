# Clima y diálogos: desarrollo 0.3

## Clima nativo

Unreal Engine 5.5.4 ejecuta un ciclo de lluvia propio del juego. No consulta servicios meteorológicos ni representa el clima actual de Neiva. La prueba jugable completa de esta versión sigue en curso; compilar e importar recursos no acredita por sí solo su aspecto, rendimiento o funcionamiento en un paquete distribuido.

El ciclo automático dura 140 segundos de juego:

| Etapa | Duración | Comportamiento |
| --- | ---: | --- |
| Despejado | 45 s | Sin gotas; las superficies siguen secándose. |
| Comienza a llover | 15 s | La intensidad aumenta gradualmente de 0 a 1. |
| Lluvia | 60 s | Intensidad completa. |
| Escampando | 20 s | La intensidad desciende gradualmente hasta 0. |

La humedad se integra con una constante de tiempo de 18 s durante la entrada y la lluvia, y de 55 s durante la salida y el período seco. El suelo conserva humedad al escampar. El cálculo integra las transiciones cúbicas y el secado sin depender de cómo se reparta el tiempo entre cuadros. Forzar lluvia o seco también conserva una transición gradual; volver al modo automático reanuda el ciclo.

El actor se guía por el personaje o el carro que posee el jugador. Usa el tiempo de juego, y la pausa detiene tanto el ciclo como el reloj de desplazamiento de las gotas. Esta es la intención implementada; su comprobación nativa de pausa y conducción se registra por separado.

### Materiales, cielo y gotas

Una colección global `MPC_NeivaWeather` controla `RainAmount`, `Wetness` y `RainTime`. Sólo se modifican estos cinco materiales padre:

- `M_Road`: asfalto.
- `M_Pavement`: pavimento.
- `M_Roof`: techos genéricos.
- `M_Landmark_roof`: techos de los hitos detallados.
- `M_Landmark_pavement`: pavimento de los hitos detallados.

Se conservan las texturas, UV, colores de vértice y parámetros de las instancias existentes. La humedad oscurece progresivamente el color, reduce la rugosidad conservando su variación y suaviza parcialmente la normal del material. Piel, ropa y vegetación conservan sus materiales propios. Esto no añade charcos con geometría ni una simulación de agua acumulada.

El sol atmosférico principal pasa gradualmente de su intensidad original al 24 % durante la lluvia —75.000 a 18.000 lux en esta escena— con un cambio suave de color. Se incrementa la dispersión Mie para atenuar el cielo despejado. Al acabar se recuperan exactamente los valores secos. Las luces de relleno opcionales conservan sus ajustes; no se añaden nubes volumétricas ni otra iluminación global.

Las gotas son geometría original: dos planos cruzados, cuatro triángulos por instancia, de 2 cm de ancho y 44 cm de longitud antes de su variación de escala. Un material analítico las desplaza en la GPU; no usa imágenes generadas, atlas externos ni un codificador de vídeo. Son trazos visuales de lluvia, no gotas físicas simuladas individualmente.

El campo local mide 36 × 36 m y sigue al jugador sin girar con el carro. La calidad de efectos selecciona 128, 256, 384 o 512 instancias; la configuración alta usada en revisión tiene 512. `-NeivaRainDrops=` permite ajustar esa cantidad en múltiplos de 64, entre 64 y 768. Las gotas no proyectan sombras, no participan en iluminación indirecta ni colisionan con personajes.

La protección aproximada bajo techos usa columnas de 4,5 m: una consulta de colisión alimenta varias gotas. Se procesan como máximo 16 columnas por actualización de al menos 50 ms. El método puede diferir del borde exacto de una cubierta; no calcula viento, impactos ni intercepción individual por cada hoja. Los límites verticales de la malla se extienden 2.400 cm para cubrir el desplazamiento del material incluso en las instancias más pequeñas. Esa extensión sólo afecta la visibilidad, no añade volumen de colisión.

### Preparación y comprobaciones

La fuente está en [NeivaWeather.cpp](../unreal/NeivaAbierta/Source/NeivaAbierta/NeivaWeather.cpp), [NeivaWeatherCycle.h](../unreal/NeivaAbierta/Source/NeivaAbierta/NeivaWeatherCycle.h) y [prepare_weather_editor.py](../unreal/NeivaAbierta/Scripts/prepare_weather_editor.py). La geometría y el shader originales están descritos en [weather_asset_plan.py](../unreal/NeivaAbierta/Scripts/weather_asset_plan.py), bajo la licencia MIT del proyecto.

El preparador se ejecuta dentro del editor, después de crear los materiales PBR y antes de cocinar el paquete. Conserva las conexiones secas y reconoce las ramas húmedas ya preparadas. Un puente C++ limitado al editor conecta `WorldPositionOffset`: Unreal 5.5 oculta esa entrada del enum de su API Python. El juego no enlaza el módulo `MaterialEditor` para esta operación.

Comprobaciones realizadas:

- Compilación real de los tipos C++ y el puente en Unreal 5.5.4.
- Ocho [pruebas CPU](../unreal/NeivaAbierta/Scripts/tests/test_weather.py) aprobadas: ciclo, continuidad, cambios manuales, integración con distintas particiones temporales, tiempo detenido, secado, límites numéricos y orientación/dimensiones de las gotas.
- Preparación e importación nativas aprobadas. La cuarta ejecución verificó explícitamente `rain mesh bounds verified Z=2400.0`; el informe del preparador está en `Saved/NeivaWeather-prepared.json`.
- La captura nativa de revisión muestra lluvia y cielo atenuado, con los materiales del personaje conservados. La validación completa de interacción, pausa, conducción, rendimiento y paquete corresponde a los recibos de QA de esta versión.

Los registros de trabajo locales están en `artifacts/upgrade-03/`. No se presentan como archivos públicos de la entrega ni como una medición de rendimiento por sí solos.

## Grabación de evidencia VP8

[stream-encoded-recording.mjs](../scripts/stream-encoded-recording.mjs) copia los cuadros VP8 recibidos después de reconstruirlos desde RTP y antes de decodificarlos. El vídeo se remultiplexa con FFmpeg mediante copia de códec: sin `MediaRecorder`, recodificación, cambio de resolución, inserción de cuadros ni ajustes artificiales de FPS.

La conexión puede entregar una ráfaga de vídeo anterior con timestamps repetidos o en retroceso. El grabador ahora se instala antes de abrir el reproductor, pero empieza a guardar después del calentamiento del vídeo decodificado. Exige tres avances reales del reloj RTP tras la última discontinuidad, solicita un fotograma clave mediante la API oficial `PixelStreaming.requestIframe()` y empieza en ese fotograma. El inspector espera ese inicio antes de enviar las acciones que quiere registrar.

El informe declara el instante efectivo de inicio, los cuadros de conexión excluidos y sus anomalías. No afirma cubrir acciones anteriores. Los timestamps repetidos dentro de la grabación se conservan; una vuelta válida del reloj RTP de 32 bits se desenvuelve. Un retroceso posterior al inicio sigue siendo un error: los cuadros no se ordenan por timestamp ni se les inventan tiempos para producir un vídeo aparentemente correcto. El diagnóstico conserva el último retroceso aunque la ráfaga anterior haya llenado las muestras con repeticiones.

El límite es de 60 s y 32 MiB. El IVF conserva ticks exactos de 90 kHz; WebM cuantiza los tiempos a milisegundos. La comprobación compara cantidad y orden de cuadros, SHA-256 de cada payload y PTS tras remultiplexar. Diez [pruebas del grabador](../tests/stream-encoded-recording.test.mjs) están aprobadas, incluidas fronteras de vuelta RTP, paquetes antiguos, inicio diferido y decodificación real de un fixture VP8 con FFmpeg/ffprobe. El fixture se genera sólo para la prueba; no representa una captura del juego.

Estas comprobaciones del contenedor no prueban la identidad del proceso Unreal, fidelidad geográfica, rendimiento del juego ni validez de una interacción. La nueva grabación nativa después del calentamiento debe validarse también en el escenario real.

## Conversaciones y comprobación local del editor

La manifestación de diálogos incluye siete WAV PCM originales sintetizados
offline: tres saludos y cuatro temas. Las voces fueron generadas con Piper
1.8.0 y el modelo fijado `es_MX-ald-medium`; ni el ejecutable Piper ni el modelo
ONNX se distribuyen dentro del juego. La licencia del conjunto de voz,
procedencia, textos, tamaños y SHA se conservan en
[`data/dialogue/neiva-dialogue.json`](../data/dialogue/neiva-dialogue.json)
y [`public/audio/dialogue`](../public/audio/dialogue). Son personajes y
diálogos escritos para el juego, no testimonios de habitantes reales.

La interacción elige entre personas y coche próximos con distancia 3D y
visibilidad. El HUD usa el mismo criterio que E. El peatón se detiene y mira
al personaje durante la conversación; 1–4 o botones cambian de tema.
E/Esc/P cierran primero la conversación, detienen su sonido y restituyen
el control. Movimiento, salto, carrera y reinicio se bloquean mientras se
lee; una conversación inválida, alejada más de 5 m o inactiva 75 s se cierra.
El tema Contacto muestra el correo público de Jhon y un botón para abrir
el programa de correo; no se envían mensajes automáticamente.

La población inicial pasó de tres peatones alejados a ocho, con cinco dentro
o cerca del parque y los demás sobre caminos cartográficos existentes.
Las tres rutas adicionales son circulación simulada dentro del polígono
pavimentado, con márgenes a edificios, fuente y mobiliario estimado. No
añaden edificios ni afirman reproducir recorridos reales de habitantes.
Unreal valida suelo, cápsula libre y separación antes de cada aparición.

El 08/09/2026, la partida **UnrealEditor -game** pasó 19 comprobaciones
correlacionadas con su registro nativo: cámara sin botones de ratón, pausa
y reanudación a pie y en coche, entrada y salida del vehículo, cuatro temas
con voz activa, bloqueo de W/Espacio/R dentro del diálogo y movimiento
restaurado al cerrarlo, lluvia gradual, pausa del clima, humedad restante
y secado, ocho peatones válidos y cierre normal con código 0. La captura
local conservó 1920 × 1080. Los ~30 FPS recibidos corresponden a WebRTC
con límite de 30 y no son un benchmark nativo sin límite.

Una captura separada recibió 9,57 s de voz no silenciosa: RMS −23,97 dBFS
y pico −9,30 dBFS. Se registró el track de audio, sin reproducirlo por
los altavoces del escritorio. La grabación de prueba MediaRecorder
recodificó Opus y FFmpeg notificó un error de encabezado en un paquete;
por tanto acredita señal recibida y correlación con el diálogo, **no una
decodificación sin errores ni una prueba auditiva humana**.

Los recibos locales son `artifacts/upgrade-03/editor-review-verified.json`
y `audio-observations/observation-LlZjJM/audio-rms.json`. Esta sesión
usó el suplemento automático de alturas; la revisión manual única se
aplicó después y debe comprobarse en el paquete final. Estos ensayos
no se presentan como prueba de una descarga pública 0.3.
