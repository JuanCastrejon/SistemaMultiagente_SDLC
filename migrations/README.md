# Migraciones

Cada release que cambie archivos gestionados registra una carpeta `migrations/<version>/` con `up.mjs` y `README.md`, y una entrada en el `REGISTRY` de `src/migrations.js`. Una version sin entrada hace que `sdlc upgrade` la rechace con "Version no soportada".

## Contrato de `up`

```js
export function up(files, context) {
  // files: mapa { rutaRelativa: contenido } con lo que el framework VA a escribir,
  //        ya renderizado desde templates/ para la version destino.
  // context: estado real del repo consumidor (ver abajo).
  // return: mapa parcial que se mergea sobre `files`.
}
```

`context` trae:

| Campo | Tipo | Para que |
|---|---|---|
| `target` | `string` | Raiz del repo consumidor |
| `config` | `object` | Config resuelta para la version destino |
| `readDisk(ruta)` | `string \| null` | Contenido REAL del consumidor, normalizado a LF |
| `existsOnDisk(ruta)` | `boolean` | Si el archivo existe en el consumidor |

## Por que existe `context`

Hasta 1.7.1, `up` solo recibia `files`, es decir lo que el framework iba a escribir. Eso hace imposible cualquier migracion que dependa del estado real del consumidor: mover contenido de un archivo personalizado, decidir segun lo que hay en disco, o migrar datos que el consumidor edito a mano. `context` es aditivo: las migraciones que solo usan `files` siguen funcionando sin cambios.

## Reglas

1. `up` es puro respecto al disco: **lee** con `context.readDisk`, nunca escribe. Escribir es responsabilidad de `writeManagedFiles`.
2. Toda migracion registra su marcador `.sdlc/migrations/<version>-applied.txt`.
3. Si la migracion toca un archivo que el consumidor pudo personalizar, tiene que contemplar que ese archivo este en `.sdlc/overrides.yaml`: en ese caso el consumidor conserva su version y la migracion no debe asumir que su contenido quedo aplicado.
4. `sdlc upgrade --dry-run` debe seguir siendo seguro: `up` no puede tener efectos secundarios.
