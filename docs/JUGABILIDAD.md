# Movimiento y recorrido: módulo 0.4

`src/gameplay.js` contiene reglas deterministas, sin DOM, WebGL, red ni
almacenamiento. Separa la simulación del dibujo para que una bajada de FPS
no reduzca la velocidad de caminar o conducir. La escena y sus colisiones
pertenecen al integrador; este módulo propone desplazamientos y recibe el
desplazamiento que la geometría permitió.

## Contrato con el bucle

```js
const simulation = createFixedStepper({ step: 1 / 60, maxSteps: 120 });
let walk = { vx: 0, vz: 0 };

function simulateWalk(dt, input, player, blocked) {
  const motion = stepWalk(walk, input, dt);
  const before = { ...player };
  moveWithCollision(player, motion.dx, motion.dz, blocked, .45);
  walk = settleWalkMotion(motion, player.x - before.x, player.z - before.z, dt);
  // walk.movingSpeed anima los pasos según el desplazamiento real.
}

// elapsedSeconds es el intervalo real entre frames visibles, sin Math.min(.05).
const timing = simulation.advance(elapsedSeconds, (dt, simulationTime) => {
  // Conservar estado anterior, simular y guardar estado actual.
  simulateWalk(dt, readInput(), player, blocked);
});
// Interpolar sólo la presentación entre estado anterior/actual con timing.alpha.
// Al pausar, perder foco o esconder la pestaña:
simulation.reset();
walk = { vx: 0, vz: 0 };
```

`advance` devuelve `steps`, `ticks`, `elapsedSeconds`, `simulatedSeconds`,
`pendingSeconds` y `alpha`. Un frame ejecuta como máximo 120 pasos: si existe
sobrecarga, el tiempo pendiente queda acumulado y visible. `advance(0, tick)`
también puede consumir esa deuda. No se descarta tiempo para aparentar FPS.
El integrador debe pausar en una pestaña oculta y reiniciar el reloj al volver;
reproducir minutos de ausencia no forma parte de la simulación.

El paso fijo es `h = 1/60 s`; por frame:
`A ← A + Δt`, `N = min(floor((A + ε)/h), 120)`, `A ← A − Nh`.
`ε = h × 10⁻⁸` corrige residuos de representación decimal; no concede tiempo
adicional de juego. El costo es `O(N)` más el de cada consulta de colisión;
el reloj requiere `O(1)` memoria. El trabajo gráfico sigue ocurriendo una vez
por frame. Interpolar ángulos requiere la diferencia envuelta en `[-π, π]`.

## Caminar

`stepWalk({vx,vz}, {forward,sideways,yaw,sprint}, dt)` devuelve
`{vx,vz,dx,dz,speed}`. Los ejes de entrada se limitan a `[-1,1]` y se normalizan
juntos para impedir que avanzar en diagonal dé una velocidad mayor.
`yaw` corresponde a la cámara existente: W avanza en
`(-sin(yaw), -cos(yaw))` y D en `(cos(yaw), -sin(yaw))`.

La velocidad deseada es 2 m/s al caminar y 5,4 m/s al correr, compartida con
`controls.js`. La aceleración es 12 m/s²; al soltar los controles se frena a
18 m/s². Cambiar hacia el sentido opuesto usa 22 m/s². Son parámetros del
juego, no mediciones de una persona. La velocidad se acerca al vector deseado
con un cambio máximo `a h`; el desplazamiento usa
`Δp = (v_anterior + v_nueva) h / 2`.

`settleWalkMotion(motion, actualDx, actualDz, dt)` recibe el resultado de
`moveWithCollision`. Conserva la velocidad final de los ejes libres y elimina
la de los ejes bloqueados. Devuelve además `movingSpeed` y `collided`.
Así, tocar una pared conserva el deslizamiento permitido y no almacena un
impulso que reaparezca al dejarla atrás. Ambos cálculos cuestan `O(1)`.

## Conducir

`stepVehicle({speed,angle,steerAngle}, {throttle,steer,brake}, dt)` devuelve
`{speed,angle,steerAngle,yawRate,mode,dx,dz}`. `throttle` y `steer` están en
`[-1,1]`; `brake` es booleano. `angle = 0` apunta hacia `+Z`. Girar a la
derecha (`steer = 1`) disminuye el ángulo, como los controles anteriores.

| Parámetro | Valor del juego |
|---|---:|
| Límite hacia delante | 20 m/s, 72 km/h |
| Límite de reversa | 4,5 m/s, 16,2 km/h |
| Aceleración hacia delante | 6 m/s² |
| Aceleración en reversa | 3 m/s² |
| Frenado | 10 m/s² |
| Resistencia al rodar sin acelerador | `0,65 + 0,003 v²` m/s² |
| Distancia entre ejes del modelo cinemático | 2,55 m |
| Giro máximo a baja velocidad | 0,62 rad |
| Velocidad de cambio de dirección de las ruedas | 2,8 rad/s |
| Aceleración lateral máxima usada para limitar el giro | 6 m/s² |

Pulsar el sentido contrario frena hasta cero; la propulsión en ese sentido
comienza en un paso posterior. El freno tiene prioridad y nunca conecta por
sí mismo la reversa. Soltar el acelerador reduce la velocidad gradualmente.
El carro parado puede mover su dirección, pero no gira sobre su propio centro.

Se utiliza una bicicleta cinemática: `ω = −v tan(δ)/L`, con
`|δ| ≤ min(0,62, atan(6L / max(1,v_max²)))`, donde `v_max` es la mayor
rapidez entre el inicio y el final del paso. El ángulo se integra en un paso fijo
y la posición usa la orientación de la mitad de ese paso. Este límite reduce
los giros bruscos a velocidad alta. Es una dinámica simplificada: no simula
neumáticos, suspensión, caja de cambios ni impactos deformables.

`settleVehicleMotion(motion, actualDx, actualDz, dt)` conserva sólo la fracción
de velocidad compatible con el avance permitido por la colisión. No añade
energía ni conserva aceleración acumulada contra una pared. Añade
`movingSpeed` y `collided`. Se integra con el radio de colisión actual de
1,45 m; la comprobación de salida del carro sigue en `safeExit`.

## Puntos de observación

`createObservationStops(destinations, {survey, resolveAccess})` crea fichas
originales y sus referencias. `resolveAccess(place)` debe devolver un punto
`{x,z}` comprobado contra colisiones, proyectado hacia una calle o un acceso
abierto. Si no hay punto válido, no se crea la parada. No se emplea sin aviso
el centro de una huella que podría estar dentro de un edificio. También se
admite `destination.point` cuando ya fue comprobado por el integrador.

Las fichas fusionan los `sourceIds` de lugares, elementos revisados y
correcciones de `neiva-survey.json`. Conservan las referencias sin URL como
títulos sin enlace; una captura aportada por el usuario no adquiere una URL
inventada. La Catedral añade la referencia de la Diócesis ya documentada en
[LUGARES-MODELADOS.md](LUGARES-MODELADOS.md). La ficha del estudio se excluye:
su contacto mediante E permanece separado. El resto de las paradas existentes
puede usar la misma guía sin inventar comercios, personajes ni misiones.

```js
const stops = createObservationStops(destinations, { survey, resolveAccess });
const tour = createObservationTour(stops, savedObservationIds);
tour.select(destinationId); // Elegir una guía no teletransporta ni suma progreso.
const nearby = tour.nearby(player, { onFoot: !driving, canObserve });
// Sólo en la pulsación explícita de E:
const result = tour.observe(nearby.stop.id, player, { onFoot: !driving, canObserve });
if (result.ok) {
  // Mostrar nombre, result.stop.text, foco de observación y referencias.
  // Persistir result.progress.ids si result.firstVisit === true.
}
```

`canObserve(position, observationPoint)` es una consulta opcional de visibilidad
del integrador. Tanto `nearby` como `observe` la respetan. La observación exige
estar a pie y a no más de 18 m del acceso, y nunca ocurre automáticamente a
55 m de un centro. Reabrir una ficha no suma otra visita. Las restauraciones
filtran IDs desconocidos y duplicados; una nueva clave de almacenamiento
evita heredar las antiguas visitas automáticas como observaciones explícitas.

El recorrido expone `select(id|null)`, `selected()`, `next()`, `progress()`,
`nearby(position, options)`, `observe(id, position, options)` y
`guide(position, heading)`. `progress()` devuelve `{completed,total,ids}`.
Una observación rechazada devuelve `{ok:false,reason}` con `unknown`,
`vehicle`, `out-of-range` u `occluded`; una válida devuelve
`{ok:true,firstVisit,stop,progress}`. El estado no accede a `localStorage`.

La guía también existe como `guideToDestination(position, destination, heading)`.
Usa `destination.point` o un punto plano `{x,z}`. Devuelve distancia, distancia
restante hasta el radio de observación, rumbo cardinal, ángulo relativo,
dirección legible y `arrived`. El ángulo relativo positivo significa derecha.
Las distancias son en línea recta; no describen una ruta peatonal libre de
obstáculos. Elegir una parada debe poder activar esta guía; el viaje instantáneo
puede conservarse como una acción explícita del mapa.

El recorrido pequeño cuesta `O(L)` en memoria y consultas de proximidad;
seleccionar un ID cuesta `O(1)`. Crear fichas cuesta `O(D·F + S + R)`, donde
`D` son destinos, `F` registros de la revisión, `S` fuentes y `R` pertenencias
de fuentes reunidas por destino. No se recorren las huellas urbanas en cada
paso para resolver estas interacciones. El HUD
debe insertar nombres y descripciones como texto, nunca como HTML de OSM.

## Verificación del módulo

`node --test tests/gameplay.test.mjs`: 15 pruebas. Se comparan las trayectorias
de caminar/correr y conducir/girar/frenar/revertir a 15, 30, 60 y 120 FPS, con
los mismos controles en los mismos pasos. Umbral fijado: diferencia menor o
igual a `10⁻⁸ m` en posición. Se exige conservar todo el tiempo simulado,
incluida una sobrecarga que exceda el máximo de pasos por frame.

La frenada conocida parte de 12 m/s y debe recorrer
`v²/(2a) = 7,2 m`, con tolerancia `10⁻⁶ m`. Se prueban límites diagonales,
reversa después de detenerse, dirección en reposo, giro a velocidad alta,
paredes de 0,1 m de grosor sin atravesarlas y ausencia de impulso al liberar
una colisión. Las pruebas de recorrido impiden el progreso por proximidad,
en vehículo, fuera del radio o sin visibilidad; verifican fuentes y puntos
explícitos de acceso. Datos de entrada no finitos no contaminan las posiciones.

Estas pruebas verifican la simulación y sus contratos. La integración 0.4 se
comprobó en Chrome con GPU Intel real a 1440 × 960 y emulación táctil de
320/390 × 844: caminar a 2,00 m/s, correr a 5,40 m/s, conducir, frenar, bajar,
Pointer Lock, sensibilidad, clima, pantalla completa y fotografía. Elegir una
guía conserva la posición; observar requiere E y abre una ficha con fuentes;
la pausa no mueve al personaje. Se probaron Palacio de Justicia, Templo
Colonial y Parque Santander, además del estudio y del inspector de edificios
con su enlace a Street View. Los tres tamaños terminaron sin errores JS ni
respuestas HTTP fallidas, y los móviles sin desbordamiento horizontal.

La emulación táctil no mide un teléfono físico. `σ = desconocida` para la
percepción de respuesta y la tasa gráfica en los dispositivos de cada usuario;
las mediciones de render están separadas en [RENDIMIENTO.md](RENDIMIENTO.md).

## Mapas que conservan su dibujo

`createMapView(data, destinations)` de `src/map-view.js` devuelve
`draw(canvas,{full,player,heading,selectedId})`, `stats()` y `dispose()`.
El minimapa conserva su escala de 0,28 px/m. La geometría se guarda en tiles
de 512 m y 256 px, consultados por `createFeatureIndex` únicamente cuando
falta un tile en la caché. Cada consulta incluye el margen de los trazos;
una calle larga que cruza el sector se conserva aunque ambos extremos
queden fuera. El raster de cada tile se recorta a su propio rectángulo.

La caché LRU conserva como máximo 16 tiles: `16 × 256² × 4 = 4.194.304`
bytes RGBA, 4 MiB. Es el tamaño de píxeles retenidos en esos tiles; no es una
medición de toda la memoria del navegador. El atlas completo se dibuja una
vez por tamaño retenido y conserva como máximo dos tamaños. Su memoria y la
de los índices se cuentan por separado. Los marcadores, el jugador y la línea
de orientación se dibujan sobre esa base. La etiqueta del destino elegido
tiene prioridad cuando varias paradas centrales coinciden en pantalla.

`stats()` publica construcciones, aciertos y expulsiones de tiles/atlas,
cantidad y bytes de píxeles retenidos, geometría pintada acumulada y la del
último dibujo. Una actualización caliente del minimapa debe tener
`lastFeatureCount = 0`. `dispose()` elimina las referencias y pone a cero
las dimensiones de los canvases internos.

Las siete pruebas de mapas verifican reutilización, bordes, trazos anchos,
presupuesto de 16 tiles, tamaños del atlas, prioridad de etiquetas y datos
degenerados mediante un adaptador de canvas que registra las operaciones.
No sustituyen la inspección visual en navegador. Ocho pruebas espaciales
incluyen 204 consultas del recorte revisado de Neiva: 102 puntos, en modo
peatonal y de conducción. El resultado del índice debe coincidir con la
búsqueda original por todos los segmentos, con tolerancia de `10⁻⁸ m`.
También se comprueban empates, patios, alturas, distancia límite del rayo y
paso de la inspección bajo cubiertas abiertas, con sus soportes y losas.

El runner `scripts/check-browser.mjs` permite aislar escritorio o móvil con
`GAME_TEST_DEVICE=desktop|mobile` y guardar evidencia en
`GAME_TEST_ARTIFACT_DIR`. Las pruebas táctiles usan una única secuencia de
TouchHandle de Puppeteer. El movimiento de cámara recorre 48 px en seis pasos
de 35 ms: un salto instantáneo producía en Chrome emulado un toque posterior
con `pointerdown`/`pointerup`, pero sin `click` nativo. La secuencia continua
permite comprobar la interacción habitual sin reintentos ni eventos DOM
artificiales. El código del juego no se alteró para ese comportamiento del
runner. Cada dispositivo aprobado se guarda inmediatamente; un fallo deja
la captura, el estado y los resultados ya obtenidos en `failure.json`.
