# Diferencias visuales de los hitos centrales

Revisión del 7 de septiembre de 2026 sobre las fotografías primarias ya consultadas, las huellas OSM y la geometría original exportada a Unreal. No aporta nuevas dimensiones medidas ni una inspección completa de Neiva. Los resultados estructurados están en [newaudit-landmarks-visual.json](../data/newaudit-landmarks-visual.json).

| Elemento | Geometría de la alfa auditada | Evidencia y corrección prioritaria |
| --- | --- | --- |
| Hotel Neiva Plaza | Frente OSM de Calle 7: **38,448 m**; lateral largo: **75,410 m**; área del polígono: **2383,45 m²**. Altura modelada **19,8 m, estimada**. | La [foto del hotel](https://www.hotelneivaplaza.com/en/) muestra cuerpos y frentes diferenciados, galerías, balcones horizontales y esquina maciza ocre. El código repite cuatro filas de habitaciones sobre los catorce bordes, incluso entrantes posteriores sin referencia. Componer cada frente observado y dejar como no verificadas las elevaciones ocultas. |
| Catedral | Frente OSM **33,464 m**, fondo próximo a **72,24 m**; altura nominal **33 m** por etiqueta OSM. Aguja modelada **8,3674 m**, interpretada. | La [foto de la Diócesis](https://diocesisdeneiva.org/directorio/parroquias/Inmaculada-Concepcion---Catedral) respalda la torre, aguja larga y carácter neogótico. El portal central real distingue hojas rojas inferiores y un remate apuntado con tracería/vidrio; el modelo rellena de madera roja toda la abertura ojival y repite ese tratamiento en puertas laterales. Separar esos componentes sin inventar nuevas medidas. |
| Parque Santander | Polígono OSM de **11.183,76 m²**; doce posiciones interiores de árboles propuestas, no levantadas en campo. | La [foto municipal de la fuente, publicada el 12/03/2024](https://www.alcaldianeiva.gov.co/NuestraAlcaldia/SalaDePrensa/Paginas/Fuente-del-Parque-Santander-se-recupera-gracias-al-trabajo-de-la-alcald%C3%ADa-de-Neiva.aspx) y la fotografía del hotel muestran copas densas y palmas altas. La exportación actual omite árboles y partículas de agua expresamente. Restituir vegetación nativa y surtidores antes de añadir pequeños adornos. |

Todas las longitudes y áreas anteriores se calculan sobre los polígonos cartográficos: **no certifican dimensiones físicas del inmueble**. La fecha de publicación de una foto tampoco determina cuándo se capturó.

## Hotel: no confundir la caja envolvente con el frente

Los **83,13 m** del modelo son la extensión norte-sur de su caja envolvente, después de orientar la planta. No son el ancho de la fachada que mira a Calle 7. El hotel conserva una planta irregular con entrantes. Encoger el conjunto por esa cifra cambiaría su implantación sin evidencia.

En la fotografía oficial se distinguen tres hileras repetidas de balcones de habitaciones bajo una galería superior abierta. El modelo genera cuatro hileras y otra banda superior en todo el perímetro. Esto permite revisar la composición visible, pero no certificar el número de pisos: la perspectiva, la altura comercial y posibles entrepisos impiden convertir la foto en un conteo topográfico. Los seis niveles del fixture y sus 19,8 m deben seguir marcados como estimados.

Los locales de planta baja necesitan accesos y huecos profundos separados por soportes; la franja reflectante casi continua de la alfa pierde esa identidad. Los balcones también deben leerse como losas y barandas largas, con huecos detrás. Una textura más nítida no corrige esa geometría. Las fachadas posteriores y sus entrantes no tienen respaldo en esta foto para repetir balcones decorativos.

## Catedral: conservar la silueta corregida

La aguja larga ya está en la geometría exportada. No hay evidencia nueva para variar los 33 m nominales. La siguiente mejora debe concentrarse en el portal, contraventanas, tracería, molduras y juntas del ladrillo visibles en la referencia. El fondo, cubiertas ocultas y posición exacta de cada abertura siguen interpretados.

La captura final de inicio del ejecutable mira en otra dirección; esta comparación de la catedral se basa en la fotografía y la malla original, no en una nueva fotografía frontal del render nativo.

## Parque: falta una parte principal de la escena

El exportador de hitos no ejecuta el módulo de vegetación y declara `Trees` entre sus omisiones. También omite `Points`, usados por los chorros animados. Sí conserva la geometría estática del vaso y del espacio cívico. La ausencia de dosel en la vista nativa no es una interpretación respaldada del parque real.

Las coordenadas propuestas pueden servir para recuperar su carácter de parque arbolado, con comprobación de colisiones, pero no deben presentarse como un inventario exacto. El centro provisional de la fuente, radio de 6,2 m, borde de 0,25 m y chorros de 2,5 m tampoco son mediciones. No se trasladan imágenes de terceros al repositorio ni se usan como texturas.

Estas correcciones mejoran identidad y composición. La alfa conserva una calidad visual muy inferior a una producción AAA y no satisface todavía la reconstrucción hiperrealista solicitada.

## Refinamiento implementado en los generadores

El código posterior a esta auditoría corrige dos componentes. Esto **no modifica por sí solo el ejecutable 0.1.0 publicado**: hace falta exportar, importar y comprobar la siguiente compilación nativa.

- **Hotel:** conserva el polígono y la altura estimada de 19,8 m. Los frentes 0 y 1 tienen tres hileras de habitaciones y galería superior abierta; el frente de Calle 7 usa vanos más anchos y soportes más finos que el lateral largo. La esquina ocre permanece maciza. Los locales y ventanas se colocan detrás de las losas y los marcos, con huecos geométricos efectivos. Las fachadas posteriores reciben mampostería sencilla y siguen sin verificar.
- **Catedral:** la madera se limita a hojas rectangulares inferiores; arriba quedan vidrio y tracería de fábrica separados. Los portales laterales tienen tratamientos cromáticos distintos, interpretados de la fotografía. El frontón decorativo central ya no contiene un triángulo sólido que tapaba el remate de la abertura. Se conservan la huella, orientación y silueta nominal de 33 m más el desplazamiento vertical de 0,035 m del modelo.

El retranqueo del hotel de **1,25 m**, las cotas de losas de **5,1 / 8,8 / 12,5 m**, la galería a **16,2 m**, los tamaños de vanos y las proporciones de puertas **son decisiones interpretativas**, no nuevas mediciones. No se deduce una altura exacta de la fotografía. Las dos fachadas principales tampoco constituyen un levantamiento de todos los lados del edificio.

La validación reconstruye las mallas en memoria, comprueba atributos finitos, normales unitarias, IDs, alturas y presupuesto de secciones. Rayos de prueba verifican que los locales y las tres hileras alcancen vidrio a más de un metro detrás de la fachada, que la galería no quede rellena y que la madera o el frontón no tapen el vidrio de la Catedral. El conjunto pasa de **110.618 a 71.311 triángulos** y de **45 a 47 secciones**: hay dos materiales de puertas adicionales, pero se retira la repetición decorativa injustificada del hotel. El cuerpo interior usa paredes laterales, cerrado por las losas existentes, para no duplicar tapas coplanares que rechazaba la conversión a DynamicMesh. Estas pruebas geométricas no sustituyen una revisión visual en Unreal ni certifican la fidelidad dimensional.
