# Cámara y pausa del juego nativo

La opción `--controls` prepara una prueba con un navegador temporal propio. No abre ni controla el navegador personal. Ejecutarla solamente cuando el operador confirme una partida nativa recién iniciada, sin pausa, consola cerrada, posición inicial del mapa y yaw de control de 20°. La secuencia avanza tres segundos para acercarse al coche antes de mover la cámara.

```bash
node scripts/inspect-unreal-stream.mjs --browser chrome --controls --record --seconds 10 --timeout 30
```

No se puede combinar con `--drive`, `--exercise` ni `--fixture`. `--controls` consulta `NeivaState` automáticamente; no hace falta añadir `--native-state`. Con grabación, el muestreo adicional admite como máximo 20 segundos para reservar tiempo a las consultas. El límite de grabación sigue siendo 60 segundos y 32 MiB. La ruta exige al menos tres fotogramas decodificados nuevos y avance de bytes antes de enviar cualquier entrada.

El reproductor oficial de Epic usa `LockedMouse` por defecto, que requiere un clic inicial para solicitar pointer lock. Esta prueba establece expresamente `HoveringMouse=true`: mueve el mouse sin botones pulsados y comprueba esa modalidad concreta. No valida pointer lock ni el mouse físico del ejecutable local. El comportamiento nativo de cámara se comprueba con `control_rotation` en el log, además de las imágenes.

La carpeta `artifacts/unreal-native/stream-observations/observation-*` conserva las siguientes capturas y las horas UTC de cada consulta en `report.nativeStateQueries`. Cada consulta abre la consola de una línea, escribe únicamente `NeivaState` y pulsa Enter; ese modo de consola se cierra automáticamente.

| Capturas / consultas | Criterio de revisión del log y de la imagen |
| --- | --- |
| `foot-before-look`, `foot-after-look` | El pawn sigue siendo el personaje, no se desplaza y cambia el yaw de control tras el mouse; la imagen muestra otra orientación. |
| `foot-paused`, `foot-paused-after-input` | Se ve PAUSA. Entre consultas pasa tiempo real y se envía W durante 700 ms, pero `world_seconds` y la posición permanecen iguales. |
| `foot-resumed` | Desaparece PAUSA y vuelve a avanzar `world_seconds`. No continúa caminando por la W ya liberada. |
| `car-before-look`, `car-after-look` | El pawn es el coche, cambia el yaw de control con el mouse y el coche no gira ni se desplaza. |
| `car-paused`, `car-paused-after-input` | Se ve PAUSA; W durante 700 ms no cambia `world_seconds`, posición ni velocidad del coche. |
| `car-resumed` | Desaparece PAUSA, avanza `world_seconds` y el coche permanece parado, sin acelerador retenido. |
| `foot-after-car-exit` | El pawn vuelve a ser el personaje y la telemetría del coche indica `passenger=None`. |

`controlsSequenceSent` sólo confirma que se completó el envío. `controlsVerified`, `gameplayVerified` y `nativeStateVerified` permanecen falsos en el informe automático: la prueba exige revisar las capturas y asociar cada consulta con el log del proceso nativo correcto. Si el ejecutable no admite consola o la partida no está en el estado inicial requerido, se descarta esta secuencia como prueba de controles.

En errores o interrupciones se liberan las teclas registradas y se cierra únicamente el navegador propio. El inspector no cierra el juego ni el servidor. Una interrupción durante una pausa puede dejar la partida pausada; las entradas enviadas quedan registradas para que el operador la recupere de forma consciente.
