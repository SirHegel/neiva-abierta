<!-- Plantilla de README para la raíz del paquete Linux terminado.
Copiar como README.md junto a Jugar-Neiva.sh y Linux/; las rutas Datos/ y
Licenses/ corresponden a esa distribución, no a publishing/linux en Git.
Este archivo de instrucciones no acredita una ejecución del paquete. -->

# Neiva Abierta · Unreal Engine · Linux x86_64

Explora una interpretación de Neiva, Huila, a pie o en coche. El personaje no
tiene nombre y el pequeño estudio de Jhon es ficticio. El juego usa Unreal
Engine 5.5.4. El código original del proyecto está disponible bajo MIT;
el motor y los recursos de terceros conservan sus propias licencias.

## Abrir el juego

Extrae **todo** el archivo `.tar.gz` en una carpeta de tu equipo. Desde esa
carpeta, abre una terminal y ejecuta:

```sh
./Jugar-Neiva.sh
```

El lanzador necesita conservar junto a él la carpeta `Linux/` completa, con
`Linux/NeivaAbierta.sh`, los binarios y los datos cocinados. El ejecutable
empaquetado incluye el runtime; no requiere instalar el editor para jugar.
Necesitas Linux x86_64, una sesión gráfica y una GPU/controlador compatibles
con Vulkan. No se han establecido requisitos mínimos ni un objetivo de FPS
para todas las máquinas. Esta distribución no incluye ejecutables para
Windows, Android o iOS.

El lanzador solicita Vulkan y, cuando `nvidia-smi` confirma una GPU NVIDIA
disponible, solicita [PRIME para ese proceso](https://download.nvidia.com/XFree86/Linux-x86_64/570.124.04/README/primerenderoffload.html).
Si prefieres la selección de GPU normal del sistema:

```sh
NEIVA_GPU=default ./Jugar-Neiva.sh
```

Puedes pasar opciones de ventana de Unreal, por ejemplo:

```sh
./Jugar-Neiva.sh -windowed -ResX=1280 -ResY=720
```

La carga inicial construye la geometría cartográfica y puede tardar. Conserva
todos los archivos de `Linux/`: un binario aislado no basta para abrir el juego.

## Controles

| Entrada | A pie | En coche |
|---|---|---|
| W / A / S / D | Caminar | Acelerar, girar y retroceder |
| Ratón | Mirar alrededor | Mover la cámara |
| Shift izquierdo | Correr mientras se mantiene pulsado | — |
| Espacio | Saltar | Frenar mientras se mantiene pulsado |
| E | Entrar al coche cercano o interactuar | Salir del coche |
| C / V | Cambiar el color de camiseta / pantalón | Cambiar esos colores del personaje |
| R | Volver al punto inicial | Reiniciar la posición del coche |
| Esc / P | Abrir o cerrar la pausa | Abrir o cerrar la pausa |

El menú de pausa permite continuar o salir. C y V cambian los colores de la
tela de las prendas existentes; no sustituyen la ropa por otras prendas.
Cerca del estudio ficticio, E ofrece el contacto público
`alvarezruizj289@gmail.com` y solicita abrir el programa de correo del sistema.
Si hay un coche al alcance, la interacción con el coche tiene prioridad.

## Alcance de la ciudad

La partida carga las 35.873 huellas del conjunto corregido utilizado en esta
versión, pero ese conjunto **no equivale a una reproducción exacta y completa
de toda Neiva**. La cobertura es parcial; muchas huellas y alturas son
estimadas, el relieve no es un levantamiento topográfico y las fachadas son
interpretadas. Los cuatro hitos modelados del centro tampoco son escaneos 3D.
El estudio de Jhon no representa una dirección comercial real.

La cartografía procede de OpenStreetMap y Overture Maps, con fuentes Microsoft
ML Buildings y Google Open Buildings. La fecha de descarga o de edición de un
mapa no certifica la fecha de una fotografía ni el estado actual de cada casa.
Consulta la procedencia y límites del mapa en `Datos/LEEME.txt` y sus
metadatos originales en `Datos/neiva.metadata.json`, incluidos en la descarga.

## Créditos, licencias y código

Código original: Jhon Steven Álvarez Ruiz, MIT. Personaje y animaciones:
Microsoft Rocketbox, MIT. Coche Car Concept: Eric Chadwick / Darmstadt Graphics
Group GmbH, CC BY 4.0; marcas Khronos sujetas a sus condiciones propias.
Texturas: Poly Haven, CC0. Cartografía y geometría derivada: ODbL, con
atribución adicional CC BY 4.0 para Google Open Buildings.

Las licencias y los manifiestos se distribuyen legibles en `Licenses/`.
El archivo `Licenses/NATIVE-NOTES.txt` describe los cambios del
importador nativo: en esta versión el coche es una malla combinada y las ruedas
no tienen animación independiente. Algunas notas compartidas de los recursos
describen también su uso en la edición web anterior.

Unreal Engine conserva su licencia propia y no está cubierto por la MIT del
proyecto. Sus créditos y condiciones de uso del runtime están en
`Licenses/UNREAL-AVISO.txt`. La edición Linux se distribuye
como juego cocinado; no incluye el editor ni su código fuente.

Código, instrucciones de compilación y fuentes cartográficas:
[github.com/SirHegel/neiva-abierta](https://github.com/SirHegel/neiva-abierta).
La disponibilidad de ese código no relicencia los recursos de terceros ni el
motor. Las pruebas de cada versión deben consultarse en las notas de su
descarga; este documento no certifica una plataforma o sesión no probada.
