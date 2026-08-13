# Changelog

## [Unreleased]

## [1.8.3] — 2026-08-13

Los defectos de esta versión salieron de **operar** el framework en el consumidor `manga-translator-mvp` durante el slice `alineacion-del-arbitro-de-calidad`, y están todos respaldados por la evidencia escrita de ese repo, no por lectura de código.

> **Patch con dos rupturas, y conviene decirlo aquí porque el número no lo dice.** Se numera 1.8.3 por decisión del mantenedor: la base instalada es un consumidor y la corrección no admitía esperar a un minor. Las dos rupturas están al final de estas notas y repetidas en `migrations/1.8.3/up.mjs`, que deja constancia escrita en `.sdlc/migrations/` del repo actualizado. Quien actualice tiene que **volver a firmar** cualquier atestación previa.

### Fixed — firma humana (P5, ADR 0007)

- **Una atestación dejaba de verificarse al commit siguiente.** El sujeto (`{slice, phase, tree_hash}`) se computaba sobre el **working tree en el momento de la llamada**, así que `sdlc signoff --verify` sobre una firma legítima devolvía `signoff-subject-mismatch` en cuanto entraba cualquier commit posterior — reproducido con la atestación F5 de `alineacion-del-arbitro-de-calidad`, inválida un solo commit después de emitirse. Una firma que no se puede volver a verificar no sirve como registro de que la fase se aprobó, que es exactamente para lo que existe. Ahora el árbol se lee de **git, en el commit que se presenta como firma** (`computeTreeHashAtRef`), y la verificación es reproducible indefinidamente.

  Que el árbol se haya movido **después** es una pregunta distinta y ahora se responde aparte: `fresh: false` en la salida, y `--require-fresh` para quien exija que lo aprobado siga siendo lo actual (`signoff-stale`). Confundir validez con frescura era la causa raíz.

- **Se podía firmar el vacío.** Con las superficies placeholder que deja el instalador (`apps/api`, `apps/web`) ninguna resuelve a archivos, el `tree_hash` es el SHA-256 de la cadena vacía y la firma resultaba **criptográficamente válida y semánticamente hueca**: atestaba la nada. Ahora es un error duro (`signoff-empty-subject`) tanto en `--create` como en `--verify`.

- **El firmante declarado no podía coincidir nunca con `gpg.format=ssh`.** `%GS` devuelve el UID completo con GPG (`Nombre <email>`) y el **principal** de `allowed_signers` con SSH (normalmente el email solo); la comparación era igualdad exacta contra el valor declarado, y la documentación del propio módulo indicaba la forma GPG. Un consumidor con SSH tenía que averiguarlo empíricamente y gastó un commit de bootstrap en ello. Ahora se aceptan ambas formas y el error muestra **el `%GS` realmente observado** con la línea exacta a poner en `governance.maintainers`.

- **`--create` asumía un keyid GPG.** `-S<clave>` pegado solo vale para GPG; con SSH la clave es una ruta o un literal. Se pasa con `-c user.signingkey`, que funciona en los dos formatos. Cubierto con un E2E de firma **SSH real**, además del de GPG que ya existía.

- **Se podía firmar algo distinto de lo revisado.** El commit de atestación es vacío, así que su árbol es el de `HEAD`: con cambios sin commitear en las superficies, la firma aprobaba el árbol de `HEAD` y no lo que el humano tenía delante. Ahora se bloquea con `signoff-worktree-dirty` y la lista exacta de lo que estorba, salvo `--allow-dirty` explícito.

### Added

- **`tools-doctor` comprueba la preparación para firmar.** Antes, un consumidor descubría que no podía atestar nada en el momento en que un gate humano se lo pedía, con la fase ya bloqueada: en `manga-translator-mvp` no existía `governance.maintainers` y ningún commit de la historia estaba firmado. El probe `commit-signing` cruza maintainers declarados, `user.signingkey`, `gpg.format` y —en SSH— que `gpg.ssh.allowedSignersFile` esté configurado y exista, y explica qué forma de firmante espera cada backend. Los hallazgos de `tools-doctor` ahora arrastran el `detail` del propio probe: el inventario describe la herramienta en general y no puede decir qué le falta a **este** repo.

### Fixed — árbitro de calidad

- **Las superficies se declaran dos veces y nada las cruzaba.** `.sdlc/config.json` y `quality-contract.yaml` mantienen listas separadas; el contrato se genera desde el config al instalar y después divergen en silencio. Como el árbitro y la firma leen **solo el contrato**, corregir las superficies fantasma del config dejó el KPI sin cumplir y la firma hueca igual. Nuevo hallazgo `surface-declaration-divergent` con las superficies que están en un archivo y no en el otro — `warning`, por la misma escalera de adopción que los probes sin `command_sha256`.

- **`sdlc status` era ciego a todos los slices menos uno.** `current_slice`/`current_phase` son un puntero único y el árbitro lo lee para decidir qué evalúa; con tres slices en vuelo se evaluaba uno y los demás no aparecían en ningún tablero. `phase-status.yaml` admite ahora un mapa `slices:` y `status` adjudica el phase-gate de cada uno. Aditivo: el puntero se conserva —los workflows que lo grepean siguen funcionando—, un archivo sin el mapa se comporta igual que antes, y el veredicto `ready` sigue saliendo del puntero. `validate-active-slices` cruza todos los slices declarados contra `openspec/changes/`, no solo el apuntado.

### Fixed — instalación

- **El instalador dejaba configuración falsa que parecía configuración real.** `surfaces: [apps/api, apps/web]` y cinco `<BACKEND_STACK>`: en un repo con otro layout eso no es un ejemplo, es configuración activa que hace vacuo todo gate y firma el árbol vacío. Ahora `install` escribe `surfaces: []` y `stack` en `null`, y el estado a medio configurar se ve desde el primer minuto (`config-surfaces-empty`, `config-stack-placeholder`, `quality-contract-surfaces-empty`, y `validate-surface-traceability` deja de dar verde con cero superficies). Se generan desde `config.surfaces` los dos artefactos que traían el mismo ejemplo fijo: `.github/agents/surface-traceability.json` y la superficie de las fichas `api-agent`/`web-agent`, que se resolvía por índice (`{{surfaces.0.path}}`).

- **`sdlc adopt` no tenía camino para un repo sin `package.json`.** Respondía «exige un package.json existente: no es un scaffold» y ahí acababa la pista. Sigue sin ser un scaffold por defecto, pero ahora existe `--bootstrap-package-json` y, sin la bandera, el error dice el comando exacto.

### Added — qué se mide y qué no

- **Un probe puede declararse no disponible, con motivo escrito.** `quality-gate` salía exit 2 con `violations: 0`: no suspendía por calidad insuficiente, suspendía por **no poder evaluar**, y un rojo permanente que no distingue las dos cosas enseña a ignorar la señal. Con `unavailable: { reason }` en un probe, todos los gates que dependen de sus métricas salen `not-applicable` en un bucket propio que no entra en el status. Tres contenciones para que no sea una puerta trasera: sin `reason` no hay exención, si la métrica aparece igual manda el número medido y se avisa de que la declaración sobra, y los gates de otras familias siguen bloqueando. `quality-docs` documenta la exención con su motivo.

### Fixed — encontrados probando 1.8.3 contra el consumidor antes de publicar

- **CRLF dejaba a un consumidor Windows sin poder actualizar, para siempre.** `.sdlc/install-manifest.json` se versiona; con `core.autocrlf=true` git lo entrega en CRLF al hacer checkout, y el checksum se comparaba sobre **bytes crudos**. Resultado: `doctor` reportaba `manifest-integrity` y `sdlc upgrade` abortaba con «Manifest corrupto o editado manualmente» sin que nadie hubiera tocado el archivo — es decir, ese repo no podía recibir **ninguna** corrección, incluida esta. Ahora se compara y se escribe sobre contenido normalizado a LF (se sigue aceptando el hash crudo, así que ningún checksum ya escrito deja de validar) y una edición real del manifiesto se sigue detectando. Medido en `manga-translator-mvp`: `doctor` pasa de `error` a `drift` y `upgrade --dry-run` pasa de abortar a listar sus 7 conflictos por la vía documentada (`--accept-managed`).

- **Declarar un probe no disponible quitaba un bloqueo y dejaba el mismo con otro nombre.** Los gates salían `not-applicable`, pero `phase-gate` seguía exigiendo `quality_metrics` en la evidencia (`quality-metrics-absent`): pedir la medición que se acaba de declarar imposible. Un gate cuya métrica depende de un probe no disponible ya no cuenta como medición propia prometida, y `phase-gate` publica `quality.notApplicable` con su motivo. Verificado sobre una copia del consumidor: F8 pasa de `blocked` a `ok` declarando el probe `coverage` no disponible.

- **`quality-gate` publicaba sus hallazgos bajo una clave distinta que `phase-gate`** (`surfaceFindings` frente a `findings`), así que quien leía `findings` veía un `blocked` sin ninguna razón a la vista. Ahora van bajo las dos.

### Fixed — continuidad y gate humano

- **Un checkpoint sin redactar se presentaba como continuidad válida.** Los 12 checkpoints del vault de `manga-translator-mvp`, el más reciente incluido, tenían las cinco secciones narrativas en `_(pendiente de redactar)_`. `save` devuelve ahora `narrative: { complete, pending }` y `resume` reporta el estado del último checkpoint. La señal se calcula leyendo el **cuerpo**, no un campo de frontmatter: un campo que declara «completo» es tan fácil de escribir como la sección misma.

- **El gate humano declarativo no exigía nada.** `human_gate_signoff` con un `approved_by` suelto es texto que el propio agente escribe, y `phase-gate` lo aceptaba con un aviso solo si faltaba `review_id`. Ahora la evidencia declara `signature_class` (`attestation` / `platform-review` / `declarative`, inferida si falta) y, cuando declara `attestation_commit`, **`phase-gate` re-verifica la firma de verdad**: recomputa el sujeto sobre las superficies del contrato en ese commit y comprueba firmante y trailer. Una atestación declarada que no verifica bloquea (`human-gate-attestation-invalid`), declararse `attestation` sin commit también (`human-gate-attestation-commit-missing`), y lo declarativo se nombra como tal (`human-gate-signoff-declarative`) en vez de confundirse con una revisión a la que solo le falta el identificador.

- **`npm test` fallaba en cualquier máquina con `VAULT_PATH` configurado** —la de cualquier usuario real del framework—: el caso del fallback de vault heredaba el entorno del desarrollador en vez de construir el suyo.

### Breaking

- El `tree_hash` del sujeto de firma cambia de formato (object id de git por blob, en lugar de sha256 del contenido en disco). Las atestaciones emitidas con versiones anteriores no verifican; hay que volver a firmar. `computeTreeHash` (frescura de evidencia de calidad, P7) **no** cambia.
- `install` deja de escribir superficies y stack de ejemplo. Un repo recién instalado sale en **error** en `doctor` hasta que se declaren las superficies reales. Los consumidores existentes no cambian: su configuración ya está en disco.
- `.github/agents/surface-traceability.json` se genera desde `config.surfaces` y cambia de forma (`tier` en lugar de `repoSurface`). Nada del framework lo lee; un consumidor que lo consuma a mano debe revisarlo.

## [1.8.2] — 2026-08-09

Los tres defectos de esta versión salieron de **usar** `sdlc save` en un repo recién instalado, no de leer el código.

### Fixed

- **Un marcador sin resolver viajaba como ruta real.** El config que genera `install` trae `vaultPath: "${VAULT_PATH}"` y `memoryWorkspace: "${MEMORY_WORKSPACE}"` a propósito — `validate:no-personal-paths` impide poner una ruta real ahí. Pero `expandEnv` devuelve el marcador **literal** cuando la variable no existe en el entorno, y nadie lo comprobaba después: el guard solo contemplaba `{{...}}` (mustache), no `${...}`. Resultado reproducido: `sdlc save` creaba `<repo>/${MEMORY_WORKSPACE}/vault/<slug>/checkpoints/…`, un directorio con el marcador literal en el nombre. El usuario cree que su checkpoint está en su vault y está en un directorio basura dentro del repo. Ahora un marcador sin expandir **bloquea** el uso de ese valor: se cae al `.sdlc/vault` local y la degradación se reporta en el propio checkpoint, en vez de ocurrir en silencio.

### Added

- **Checkpoints enriquecidos.** `sdlc save` producía runtime + diffstat + «Continua». Sin el porqué de las decisiones ni lo pendiente, un checkpoint no se puede retomar sin la conversación — que es justamente lo que existe para evitar. La estructura no se inventó: se tomó de los checkpoints enriquecidos **ya en uso** en los repos consumidores (`.github/agent-state/checkpoint-context.md` en CMSHeadless, 437 líneas), que llevan secciones de alcance y gobernanza —incluido **qué NO se hizo**: sin tests, sin commit, sin PR, excepciones declaradas por el usuario, y hasta secretos filtrados en la transcripción con recomendación de rotarlos—, skills y fuentes consultadas, decisiones con su porqué y lo descartado, verificación con salida real, y pendientes separando lo que espera decisión del usuario. Ahora reúne todo lo **factual** que sí puede derivar del repo (commits desde el checkpoint anterior, `supersedes`, HEAD, archivos sin commitear, qué fases tienen evidencia escrita, estado del vault) y deja **huecos explícitos** para lo que el CLI no puede saber: «Qué se hizo y por qué» y «Pendiente, con la pista de dónde mirar». El hueco dice quién lo llena y por qué importa, en vez de omitir la sección y parecer completo.

  El CLI no tiene modelo y no puede inventar el criterio de una decisión; lo honesto es exigirlo, no simularlo.

- **El vault queda fuera del control de versiones en el consumidor.** El fallback del vault es `.sdlc/vault/` DENTRO del repo, y no estaba ignorado: el checkpoint aparecia como untracked y un `git add -A` lo commiteaba. El checkpoint es memoria de trabajo de ESA maquina —lo durable se promueve a un ADR, a `openspec/` o a `docs/`—, asi que versionarlo mezcla contexto personal de sesion con la fuente de verdad del repo, y arrastra al historial lo que un checkpoint recoge sin filtrar (rutas locales, estado de runtime, menciones a secretos). Se entrega un `.gitignore` ANIDADO en `.sdlc/`, para no editar el `.gitignore` raiz que el repo destino ya gestiona a su manera.
- `migrations/1.8.2/` en el registro, para que `sdlc upgrade --to-version 1.8.2` no la rechace.

### Notas de implementación

Dos defectos propios, encontrados al probar el código nuevo antes de darlo por bueno:

- `--format=%h %s` fue rechazado por `assertShellSafeToken` (lleva `%` y espacio, metacaracteres de `cmd.exe`). Se usa `--oneline`, que produce lo mismo sin ellos. El guard de inyección del propio framework atrapó el código nuevo.
- El nombre del checkpoint sale de `toISOString()` (**UTC**) y `git log --since` sin zona interpreta la cadena en hora **local**. En UTC-5 el `since` apuntaba cinco horas al futuro y la sección de commits salía vacía **siempre**. Una sección decorativa es peor que ninguna: parece que no hubo trabajo. Se ancla con `Z` explícita.

## [1.8.1] — 2026-08-09

Encontrado instalando la 1.8.0 **publicada** en un repo brownfield real (una extensión Chrome, sin `package.json`). Ninguna suite lo veía porque todos los fixtures crean `package.json`.

### Fixed

- **`sdlc verdict` acusaba a un validador sano en repos sin `package.json`.** El veredicto devolvía `NOT-READY` con bloqueante `control-plane`, mientras `node scripts/validators/validate-control-plane.mjs` salía 0 con *"OK: 10 referencias de persona resuelven a un archivo real"*. El validador estaba bien; fallaba **cómo se invocaba**: el precheck que clasifica un paso como `not-configured` exigía `declaredScripts` truthy, y sin `package.json` eso es `null`, así que el paso se ejecutaba igual, `pnpm run` fallaba con exit 1 y el fallo se atribuía al archivo equivocado. Quien lo viera iría a depurar código sano. La intención original del código era "no romper consumidores que no son Node" y lograba exactamente lo contrario. Sin `package.json` no hay **ningún** script declarado, que es justo el caso que `not-configured` ya modela.
- **Y el arreglo anterior, solo, producía un falso VERDE.** Con los 8 pasos en `not-configured`, `blockers` quedaba vacío y el veredicto salía `READY` sobre un repo donde no corrió un solo validator. El falso verde es peor que el falso rojo porque nadie lo investiga. Se añade guarda de vacuidad: si **ningún** paso llegó a ejecutarse, el veredicto es `NOT-VERIFIABLE` (`status: not-configured`, exit distinto de 0) con `vacuousReason`, en vez de READY. Es la misma regla que el resto del gauntlet ya aplica (`gate: vacuous`, `red-proof-vacuous`): no poder medir no puede parecerse a que todo está bien.
- **`tools-doctor` reportaba `package-manager: ok` sin nada que gestionar.** En un repo sin `package.json` se cae al default `pnpm` y, como el binario existe en la máquina, `pnpm --version` responde y el check daba verde. "El gestor anda" y "hay algo que gestionar" son cosas distintas, y el harness necesita la segunda para ejecutar un solo validator. Ahora el `ok` viaja con un `detail` que lo dice, en vez de quedar desnudo. **No** se escala a `warning` a propósito: `package-manager` es un check requerido, así que un warning se volvería error y dejaría en rojo el doctor de cualquier consumidor que no sea Node — un estado legítimo. La consecuencia real la reporta `sdlc verdict` como `NOT-VERIFIABLE`, que es donde importa.

### Added

- `migrations/1.8.1/`: entrada en el registro de migraciones. Sin ella `sdlc upgrade --to-version 1.8.1` la rechazaría con *"Version no soportada"* — el mismo defecto que 1.7.1 tuvo que corregir para 1.7.0.

### Added

- **`external-tools.yaml` + `sdlc tools-install`: el diagnóstico ahora dice qué hacer.** `tools-doctor` sabía detectar nueve herramientas y reportarlas como `missing`/`warning` con una ruta; lo que no sabía era decir **qué es** cada una, si el consumidor la necesita, o **cómo** conseguirla. Ese conocimiento existía —en el README y en la matriz de docs— pero no donde el comando lo reporta, así que el usuario que instala se quedaba con una lista de "opcionales" sin forma de decidir cuáles le hacían falta. Nuevo inventario declarativo como fuente única (propósito, requerida u opcional, perfil elegible, comando de instalación, cuándo **no** usarla), leído por `tools-doctor` —que ahora enriquece cada hallazgo con propósito, `install` o `manual`, docs y un `hint` accionable— y por el nuevo `sdlc tools-install`, que cruza inventario y detección y arma un plan separado en tres grupos: `installable`, `manualOnly` (el paso lo hace una persona) y `satisfied`. Mezclar esos tres era justo lo que impedía saber qué falta de verdad.

  **Acotamiento de la ejecución**, porque un inventario que declara comandos es una superficie de ejecución: los comandos son listas de argumentos y nunca cadenas de shell (un token con `;` es un argumento literal, no un separador — la lección de la inyección por `gitFlow.integrationBranch` aplicada de antemano); el ejecutable debe estar en una allowlist corta y una entrada fuera de ella se rechaza **al cargar** el inventario, no al ejecutarlo; `tools-install` es **dry-run por defecto** y exige `--apply` explícito; y nada de esto corre durante `sdlc install`, porque instalar software de terceros no puede ser un efecto secundario del scaffold. Cuando una herramienta no tiene instalador automatizable (CodeGraph, caveman, `gh`), el inventario lo declara y entrega la instrucción manual en vez de inventar un comando.

  La detección **no** se reimplementó: `tools-install` reutiliza la de `tools-doctor`. Dos criterios distintos para "está instalada" acabarían contestando cosas distintas sobre el mismo repo, que es exactamente lo que costó caro en `detectCliLinked`.

## [1.8.0] — 2026-08-06

Brechas detectadas al instalar el framework en `PasarelaDePago`, un consumidor con `npm workspaces`, más el plan completo P1→P14 de cierre del ADR 0007 (gauntlet de calidad verificable): de cero herramientas reales a un arbitro que mide, hereda, firma, ancla y documenta desde el propio contrato.

### Fixed

- **El ancla de árbol era ciega a los dotfiles.** `computeTreeHash` excluía cualquier entrada que empezara por punto, así que un `.env`, un `.eslintrc` o un directorio `.config/` entero dentro de una superficie declarada podían cambiar sin mover el hash. Ese hash es lo que ancla la frescura de la evidencia heredada (el guard anti-regresión de F14) **y el sujeto de la firma humana**, de modo que existía una clase de archivo que se podía modificar sin invalidar ni el veredicto ni la firma. Reproducido: añadir `.env` más `.config/rules.json` dejaba el hash idéntico bit a bit. El criterio fallaba además en la dirección contraria — `dist/` no empieza por punto, así que el build output **sí** entraba y producía ruido. Ahora la pregunta es la correcta: se excluye lo que **git ignora** (`git check-ignore`, que entiende `.gitignore` anidados, `.git/info/exclude` y la precedencia real de las negaciones), más `node_modules` y `.git` siempre. Si no se puede preguntar a git se incluye todo: un ancla de más produce un falso «obsoleto», visible y corregible; una de menos produce un veredicto que pasa sobre un árbol que ya no es el medido.

  **Cambio de comportamiento**: los `tree_hash` calculados con versiones anteriores no coinciden con los nuevos. La evidencia y los baselines existentes quedan marcados como obsoletos y hay que volver a medir la fase de origen. Es la consecuencia buscada: los hashes viejos se calcularon ignorando archivos que sí forman parte del árbol.

  El helper `listIgnoredPaths` pasa a `file-utils.js` y lo comparten la política de retención y el ancla, en vez de mantener dos copias del mismo criterio — la lección que dejó `detectCliLinked` en esta misma serie, donde copia y original acabaron contestando cosas distintas sobre el mismo repo.
- **REGRESIÓN PROPIA — `detectCliLinked` marcaba como "link" cualquier instalación pnpm normal.** Introducida por el propio fix de P13 de esta serie y detectada en la revisión final contra el consumidor real. Node resuelve por *realpath*, y con pnpm el paquete vive en el store virtual (`node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>`) mientras `node_modules/<pkg>` es un enlace; anclar la comprobación al directorio exacto `node_modules/<pkg>/` daba `linked: true` sobre una instalación perfectamente sana. Verificado contra `FacturacionDian`, que usa pnpm y tiene el paquete instalado: `doctor` le habría avisado de un link inexistente añadiendo que "CI lo rechaza", cuando el bash de `quality-verify.yml` acepta **cualquier** ruta bajo `node_modules` — es decir, la función rompía la paridad con el chequeo que su propio docstring dice replicar. Ahora se pregunta si el paquete sale del árbol `node_modules` del target, no de qué subdirectorio concreto, y se compara también contra el *realpath* de ese árbol.
- **`detectCliLinked` confundía "no declarada" con "declarada pero no instalada".** `declared` se derivaba del éxito de `require.resolve`, así que un consumidor que declara la dependencia y todavía no ha corrido su install quedaba `declared: false`, indistinguible de uno que nunca la declaró — dos estados distintos colapsados en una sola señal, que es justo lo que este framework rechaza en el código del consumidor. `declared` sale ahora del `package.json`, y el nuevo campo `installed` dice si además resuelve.
- **`red-proof-verify` acreditaba varios escenarios con una sola aserción, y no declaraba su propio alcance (P10).** Tres cosas. (1) Los resultados se indexaban solo por `test_ref`, así que N escenarios distintos apuntando al mismo test cobraban crédito de un único rojo — la misma vacuidad por denominador que el resto del gauntlet rechaza, con otra forma; ahora un `test_ref` respalda exactamente un `sc_id` y la colisión se reporta nombrando con quién choca. (2) `new Map(lista)` se quedaba en silencio con la última entrada de cada clave: si el reporte traía dos tests homónimos, cuál era "la prueba" lo decidía el orden de aparición, y un fallo por aserción podía quedar tapado por un homónimo que pasa. Ahora se rechaza por indecidible en vez de elegir uno. (3) El comando no decía lo que **no** prueba. `schemas/phase-evidence.schema.json` ya reserva `red_proof_run_id` y `red_proof_sha`, y el comando no lee ninguno: adjudica un reporte que produce el propio evaluado, en la máquina que el evaluado controla. El payload declara ahora `authoritative: false`, `proofStrength: "heuristic"` y la lista concreta de limitaciones, de modo que `ok` significa "no se detectó trampa" y nunca "el rojo quedó demostrado". Entregarlo sin eso habría sido el fraude que P10 existe para detectar: un control con apariencia de control.
- **Endurecido el adapter `vitest-json` hasta donde la heurística alcanza, y documentado dónde no alcanza.** Medido, no supuesto: un `AssertionError` construido sin argumentos deja la huella degenerada `undefined undefined undefined`, y esa fabricación perezosa ahora se clasifica como error colateral. En cambio una aserción legítima con mensaje propio (`AssertionError [ERR_ASSERTION]: el pago debe rechazarse`) y un `throw new AssertionError('expected 1 to be 2')` fabricado son **idénticas por texto**: ninguna regex las separa, y cerrarlo exige procedencia de CI o un wrapper que ejecute la comparación. Ese límite está fijado con un test explícito para que nadie crea que la heurística cubre más de lo que cubre.
- **BLOQUEANTE — la evidencia heredada no estaba anclada al árbol que se fusiona (P7-a).** F14 (merge) no mide nada propio: sus tres gates son heredados de F8/F10, y `phase-contract.yaml` lo declara textualmente como *guard anti-regresión antes de fusionar*. El fix anterior cerró la mitad visible del problema —el árbitro no llegaba a ejecutar la adjudicación heredada, devolvía `evaluated: []`— y dejó abierta la otra: heredar una métrica es heredar también **el árbol sobre el que se midió**, y eso nunca se comprobaba. Reproducido con PoC contra el CLI real: se miden F8/F10 sobre un árbol limpio, se ensucia el árbol después, y `sdlc quality-gate --phase F14 --run --source ci --exit-code` —el comando exacto que corre `quality-verify.yml`— **ejecuta los probes con éxito**, mide 7 violaciones de dependencias, 3 ciclos y 12 % de cobertura de líneas cambiadas, escribe todo eso en `F14.yaml`… y adjudica los tres gates contra las métricas viejas: `pass`, `status: ok`, exit 0. La medición fresca no faltaba: corrió, acertó y se tiró. Los dos `tree_hash` estaban en disco, en los mismos archivos que el código ya leía, y el heredado se leía solo para copiarlo al payload de salida. Ahora el árbitro compara el `tree_hash` de cada evidencia de origen contra el árbol recién computado (`inherited-evidence-stale`, con las dos huellas y la fase que hay que volver a correr) y bloquea la evidencia sin `tree_hash` (`inherited-evidence-unanchored`): no poder demostrar frescura no puede parecerse a haberla demostrado. En `phase-gate`/`status`, que son síncronos y advisory, la comparación es contra el hash que la propia fase registró, para no dar falso positivo con cambios sin medir.
- **BLOQUEANTE — `detectCliLinked` era ciega justo en el escenario que existe para detectar (P13).** Resolvía la dependencia desde `import.meta.url`, es decir desde el módulo del framework, en vez de desde el repo destino. Como el framework no se depende a sí mismo, la resolución reventaba y caía al `catch`, devolviendo `declared: false` — indistinguible de "no hay dependencia" precisamente cuando hay un `npm link` activo. Ahora resuelve desde `<target>/package.json`, y los dos llamadores (`doctor`, `adopt`) le pasan el target. En la misma pieza: una dependencia ya declarada como `file:`/`link:` se dejaba pasar como "ya declarada" en vez de migrarse (es el mismo problema que la decisión 9 abandona, con otro nombre), y `adopt` escribía un `.sdlc/config.json` con `governance.maintainers: []` que viola el `minItems: 1` del propio schema del framework. El test tampoco era control: vaciar `detectCliLinked` a una constante dejaba sus cuatro sub-tests en verde; ahora se ejercita un `npm link` real vía symlink/junction.
- **Los archivos con tilde quedaban fuera del cálculo de cobertura de líneas cambiadas (P1).** Primera auditoría adversarial de `src/coverage-diff.js`, que resultó tener **los mismos tres defectos** que ya se habían corregido en el guard de frontera y nunca se portaron: `core.quotePath` hacía que git imprimiera las rutas no-ASCII escapadas en octal, con lo que el parseo del diff producía una ruta que jamás volvía a coincidir con la real y las líneas cambiadas de cualquier archivo con tilde o eñe eran invisibles para `F8.changed-lines-coverage`; el `maxBuffer` por defecto de Node reventaba en diffs grandes; y un fallo real del diff se trataba igual que "no hay ref base", degradando en silencio a un diff diminuto que se medía como si fuera genuino. Ahora las rutas se piden sin escapar, el buffer es amplio, y se distingue "ref inexistente" (degrada de forma transparente) de "el diff falló" (bloquea con `coverage-diff-unmeasurable`). Además el flag `degraded` se persiste en `coverage-summary.json` y el adapter lo expone como `coverage.changed_lines_degraded`: si solo vivía en el stdout del CLI, el motor de gates —que únicamente lee el archivo— nunca se enteraba.
- **Inyección de YAML en `quality-contract.yaml` a través de `.sdlc/config.json` (P6).** Primera auditoría adversarial de `template-loader.js`. El generador de la lista de superficies resultó **seguro** (usa `JSON.stringify`, verificado con PoC contra breakout de comillas y separadores de línea Unicode), pero `interpolate()` sustituye los campos escalares como texto crudo sin escapar, y `commandUpgrade` —a diferencia de `commandInstall`— nunca validaba el config contra el schema antes de renderizar. Cadena reproducida contra el CLI: un `project.name` con un salto de línea dentro de `.sdlc/config.json` (archivo que el guard de frontera **no** protege), más `sdlc upgrade --accept-managed .sdlc/config.json` (el camino legítimo para regenerar el contrato con superficies reales), inyecta una clave YAML real en `quality-contract.yaml` — el mismo archivo que el guard bloquea editar directamente, alcanzado por la puerta de al lado. Cerrado en dos capas: el schema prohíbe `\r`/`\n` en todo campo que se interpola como escalar de una línea, y `upgrade` valida antes de tocar nada.
- **`sdlc quality-docs` no cerraba su propia tesis (P14).** La pieza existe para que la documentación de gates no diverja del contrato, y el comando solo sabía **sobreescribir**: `--dry-run` se saltaba la escritura y devolvía `status: ok` sin haber leído siquiera el archivo existente, así que una doc comiteada que ya no describía el contrato era indetectable. Ahora se compara siempre contra lo comiteado, `--dry-run` reporta `drifted`, y el nuevo `--check` no escribe y sale 2 si divergen, diciendo qué comando la regenera. No se añade como paso obligatorio del workflow: en este framework ningún control nace en `block`. Además la tabla de gates omitía `min_denominator`, que es justamente lo que separa un gate que juzga de uno vacuo — "0 violaciones permitidas" y "0 violaciones permitidas, y solo cuenta si se escanearon al menos 10 módulos" son controles distintos, y la doc solo mostraba el primero.
- **BLOQUEANTE — el allowlist del guard de frontera se leía del checkout que controla el atacante.** Encontrado por auditoría adversarial *después* de que P2 se declarara cerrado, y reproducido empíricamente. El fix de P2 cerró la mitad visible del vector (CI trae el **script** del guard desde `origin`), pero ese script confiable seguía leyendo sus **datos** —`.github/agent-state/spec-boundary-allowlist.yaml`— con `fs.readFileSync` contra el `cwd`, es decir el checkout del PR. El ataque cabía en un solo commit: reescribir un archivo protegido y, a la vez, añadir al allowlist una entrada que lo autoriza más otra autorreferencial que autoriza el propio allowlist. El guard devolvía `status: ok, violations: []` con ambos archivos en `allowed` — el evaluado firmándose su propio permiso. El allowlist se lee ahora **siempre** desde la rama base vía `git show`, nunca del checkout: una entrada creada en el mismo PR no tiene efecto hasta estar mergeada, que es exactamente el gate humano que este control existe para forzar. La asimetría con `locked-paths.txt` (que sí se lee del checkout) es deliberada y está documentada en el código: aquel solo puede EXTENDER protección, el allowlist la EXCLUYE.
- **BLOQUEANTE — un `git mv` sacaba cualquier archivo protegido del árbol protegido sin dejar rastro.** `git diff --name-only`, con la detección de renames que git trae activa por defecto, imprime **solo la ruta destino** del par renombrado; la origen desaparece de la salida. Como el guard compara los patrones contra lo que git le imprime, `git mv openspec/specs/algo/spec.md notas/archivo.md` devolvía `status: ok, violations: 0`: el criterio contra el que se juzga al agente se podía borrar del árbol protegido y el guard no veía nada. Vaciaba el control entero, incluida su propia autoprotección — los tres archivos de `ALWAYS_LOCKED`, el script del guard entre ellos, se movían igual. Se añade `--no-renames`, con lo que git reporta el par como borrado + alta y ambas rutas entran a la comparación.
- **BLOQUEANTE — un PR grande desbordaba el buffer y el guard veía cero archivos.** `git()` envolvía `execFileSync` en un `catch` que devolvía `""` sin distinguir causas, y `execFileSync` usa el `maxBuffer` por defecto de Node (1 MiB), lanzando `ENOBUFS` al superarlo. Un diff con suficientes rutas dejaba la lista en **cero** —no un subconjunto— y el guard seguía como si el PR no tocara nada; autoinfligible acompañando el cambio prohibido con código generado o vendoring. Ahora `maxBuffer` amplio, el fallo se devuelve en vez de tragarse, y un diff que falló bloquea con `diffFailures` en el payload: no poder medir no puede parecerse a no tener nada que reportar.
- **Rutas con tildes quedaban permanentemente fuera del guard.** `core.quotePath` viene activo por defecto y hace que git imprima las rutas no-ASCII entrecomilladas y escapadas en octal (`"openspec/specs/facturaci\303\263n/spec.md"`); `matchesPattern` compara con `startsWith`, así que la comilla inicial rompía el prefijo. En un framework cuyo corpus entero está en español, bastaba un directorio con tilde bajo `openspec/specs/` para que todo lo que colgara de él fuera invisible. Se fuerza `core.quotePath=false`.
- **Base irresoluble devolvía verde.** `status: skipped` con exit 0 mientras el propio `detail` admitía que "el guard no puede comparar contra nada verificable". Ahora bloquea con `spec-boundary-base-unresolvable` y un mensaje que dice qué revisar (`fetch-depth: 0`, `gitFlow.integrationBranch`).
- **BLOQUEANTE — `quality_metrics.source` podía apagar el detector de fraude.** El fix de `--source ci` verificaba el origen donde se **escribe** (el flag) y no donde se **lee**: los tres consumidores que convierten ese campo en una decisión de confianza lo leían de un YAML que el propio evaluado escribe y commitea, en una ruta (`.github/agent-state/evidence/`) que el guard de frontera no protege. Editar una palabra —`source: harness` por `source: ci`— hacía que `detectEvidenceMismatch` devolviera `[]` y que una corrida del árbitro pasara de `blocked` a `ok`, desactivando el único detector de fraude que tiene. La regla que faltaba, y que ahora vale para todo el gauntlet: **un campo que el evaluado redacta puede encender un control, nunca apagarlo.** Se elimina el early-return por `source`; `advisory` se deriva del entorno real del proceso y no del YAML; la evidencia registra `ci_provider`/`ci_run_id`, que solo una corrida real dentro de un runner produce, y promover el baseline los exige.
- **`--source ci` era una afirmación del invocador que nada cruzaba contra la realidad.** `grep GITHUB_ACTIONS src/` daba cero resultados. El cruce existente en `promoteBaseline` cerraba el ataque ingenuo (evidencia local + promoción mintiendo) pero no el consistente: correr `quality-gate --run --source ci` y después `quality-baseline --promote --source ci` en la misma máquina producía una cadena internamente coherente y del todo falsa, sin pisar un runner jamás. Nuevo `src/ci-detect.js`: el origen efectivo se resuelve contra el entorno, y `--source ci` fuera de un runner se degrada a `harness` (advisory) reportando la degradación en vez de aceptarla en silencio. El baseline registra además `ci_provider` y `ci_run_id`. El propio módulo documenta su límite: comprobar variables de entorno no es una barrera criptográfica contra quien controla la máquina — pero ese atacante ya tiene control total bajo `threat_model: single-maintainer`, así que no es escalada de privilegio.
- **Bytes NUL crudos en tres archivos de `src/`, invisibles a todo code review.** `src/acceptance.js`, `src/retention.js` y `src/template-loader.js` usaban NUL como separador de campos y como delimitador de marcador temporal —técnica correcta, porque no puede colisionar con contenido real— pero escrito como **byte literal** en el código fuente. Consecuencias, todas silenciosas: git puede clasificar el archivo como binario y excluirlo de los diffs del PR; el código que se lee en un editor deja de ser evidentemente el que se ejecuta; y ninguna de las 13 validaciones ni de los 34 sub-tests lo detectaba. Se reescriben como escape `\u0000` — mismo byte en runtime, mismos `sc_id` ya emitidos, código honesto. Nuevo `validate:no-control-bytes` como regresión permanente: rechaza cualquier byte de control crudo (salvo `\t`, `\n`, `\r`) en los 364 archivos de texto del repo.
- `computeScenarioId` no normalizaba Unicode: el mismo título visible escrito en macOS (NFD) y en Windows/Linux (NFC) producía `sc_id` distintos, y el error resultante acusaba falsamente de haber cambiado el título. Ahora normaliza a NFC antes de hashear.
- `listFiles()` no excluía `.sdlc/` de su recorrido, así que `validate-no-personal-paths` y `validate-template-sanitization` daban falso positivo contra cualquier checkpoint del vault local. No afectaba a CI (un checkout limpio nunca tiene `.sdlc/`), solo a desarrollo local del propio framework.
- **El baseline solo se comparaba en `mode: ratchet`, y detectarlo cortaba el flujo.** Dos defectos en el mismo bloque: un gate en `mode: block` con regresion pasaba inadvertido mientras el valor siguiera cumpliendo el umbral absoluto, y en `ratchet` el `continue` tras detectar la regresion impedia evaluar el umbral. Ahora el baseline se compara SIEMPRE que exista y ambos hallazgos se reportan. Nuevo campo `on_regression: warn|block` que separa el modo (cuan exigente es el umbral) del efecto (que pasa al empeorar); default `block` en ratchet, que es el sentido del ratchet.
- **Un gate declarado por la fase que no se mide ya no es un aviso.** `evaluateQualityGates` recibe `declaredByContract`: si `phase-contract.yaml` declara un gate, medirlo es una promesa del contrato, y no cumplirla es violacion en cualquier modo. El modo gradua la exigencia del umbral, no si la medicion existe.
- **La evidencia valida pero VACIA pasaba con cero hallazgos.** Caso real del repo padre: su unico archivo de evidencia (`evidence/v1.5.0-runtime/F12.yaml`) esta bien formado, no trae `quality_metrics` y tiene `human_gate_signoff: null`, y el validador no decia nada. `detectEvidenceSmells` recibe ahora las expectativas de la fase (declara gates, tiene gate humano) y emite `quality-metrics-absent` y `signoff-absent` de nivel error. La ausencia se detecta antes que la forma.
- **El arbitro de CI asumia npm y habria roto en el consumidor mas maduro.** `templates/.github/workflows/quality-verify.yml` hardcodeaba `npm ci` y `npx --no-install`, cuando el repo padre usa pnpm con lockfile. Ahora detecta el gestor (pnpm/yarn/npm) por lockfile y usa el `exec` correspondiente. Ademas verifica que el CLI se resuelva desde node_modules y falla si viene de un link local: un arbitro que ejecuta codigo sin publicar de una rama sucia no arbitra nada.
- **`compute-calibration.ps1` daba concordancia perfecta sobre el conjunto vacio.** Con cero muestras devolvia `agreement: 1.0` y `status: ok`, el mismo falso verde por denominador vacio que los gates de calidad rechazan con `min_denominator`. Ahora exige `MinSamples` (default 10) y reporta `not-measured` con `agreement: null`. Ademas adopta la banda de histeresis que el consumidor padre ya opera formalmente: graduacion en 0.80, freeze bajo 0.75, y zona de observacion entre ambos que ni gradua ni congela, para evitar freeze-flap por ruido estadistico. El umbral unico de 0.70 que traia el framework no coincidia con ninguna politica escrita.
- **Direccion invertida en la comparacion `ratchet`.** `evaluateQualityGates` asumia que cualquier operador distinto de `lte` se comporta como `gte` (mas alto es mejor). Para gates `eq` sobre conteos donde menos es mejor (violaciones de dependencias, ciclos), eso marcaba una MEJORA como regresion y un empeoramiento como pass. Encontrado al conectar el baseline real de 1.11.0, antes de activarlo en el contrato por defecto. Test que cubre ambas direcciones.
- **El harness ya no asume pnpm.** `sdlc verdict` y `sdlc tools-doctor` ejecutaban `corepack pnpm` hardcodeado, así que en un repo npm o yarn devolvían `pnpm: missing` y `NOT-READY` sin haber corrido un solo validator. Nuevo `detectPackageManager()` en `src/harness.js` resuelve por campo `packageManager` de `package.json`, luego por lockfile, y deja `pnpm` como default. `tools-doctor` reporta el tool `package-manager` (con `manager` y `detectedFrom`) en vez de `pnpm`, y ambos comandos incluyen `packageManager` en su payload.
- `templates/scripts/validate-local-gate.ps1` aplicaba el mismo hardcodeo en la versión, el install, los `run` de scripts y los `exec` de `sdlc`. Ahora resuelve el package manager con la misma precedencia (`Resolve-PackageManager`) y usa `npm ci`, `yarn install --immutable` o `bun install --frozen-lockfile` según corresponda.
- `templates/scripts/headroom-start.ps1` y `templates/scripts/register-headroom-task.ps1`: el README y la matriz de herramientas externas los documentaban desde 1.5.0, pero el paquete nunca los entregó y `pwsh -File scripts/headroom-start.ps1` fallaba en todos los consumidores. Ahora existen y están en el manifiesto. `headroom-start.ps1` hace healthcheck con reintentos y, si falla, registra el fallo y sale con 1 sin limpiar `ANTHROPIC_BASE_URL`. `register-headroom-task.ps1` es dry-run por defecto y solo registra la tarea con `-Apply`.

- **Las migraciones pueden leer el disco del consumidor.** `up(files)` solo veia los archivos recien renderizados desde `templates/`, es decir lo que el framework iba a escribir, nunca el estado real del repo destino: cualquier migracion que dependiera de contenido personalizado era imposible. Ahora `up(files, context)` recibe `target`, `config`, `readDisk(ruta)` y `existsOnDisk(ruta)`. Es aditivo: las migraciones historicas siguen funcionando. Contrato documentado en `migrations/README.md`.
- `templates/scripts/validate-local-gate.ps1` en modo `-Strict` abortaba por cualquier `validate:*` ausente, incluidos `validate:adr-integrity` y `validate:active-slices`, que el framework NO entrega: el gate obligatorio de la regla 9 era inusable en cualquier consumidor que no los hubiera escrito. Ahora `-Strict` exige solo los artefactos que instala el framework, y los scripts del consumidor se acumulan como `no configurados` con resumen final, coherente con lo que hace `sdlc verdict`.
- **Inyeccion de shell en Windows.** `runCommand` construia una linea de comando y la pasaba a `cmd.exe` con `shell: true`, escapando comillas con la convencion POSIX (`\\"`), que en cmd.exe no aplica. El shell es obligatorio ahi desde la mitigacion de CVE-2024-27980 (Node rechaza ejecutar `.cmd` sin shell), asi que la defensa pasa a ser rechazar en vez de escapar: `assertShellSafeToken` bloquea cualquier token con metacaracteres antes de construir la linea. Relevante de cara al contrato de calidad, donde `probes[].command` vendra del YAML del consumidor.
- `tools-doctor` gana el check `pinned-tooling`: detecta scripts de gate que resuelven `@latest` en cada corrida. No son reproducibles y pagan red siempre; medido en un consumidor real, `npx @fission-ai/openspec@latest` era 9.1 de los 9.3 segundos de `sdlc verdict`.
- `sdlc --version` imprimia la ayuda y salia 0 sin decir nunca la version; ahora reporta `{version}`. Un subcomando desconocido tambien salia 0 imprimiendo la ayuda, asi que un typo en un paso de CI se contabilizaba como exito: ahora sale 1 con `Comando desconocido`. Sin argumentos sigue mostrando la ayuda con exit 0.
- `.sdlc/session.json` deja de ser archivo gestionado. Es estado local de maquina que `session-start` reescribe con rutas absolutas y salud del entorno; gestionarlo producia drift permanente en `doctor` y conflictos de upgrade sobre un archivo que nunca deberia versionarse.
- `collectDrift` hasheaba el contenido crudo mientras `detectConflicts` hasheaba el normalizado, asi que en Windows el mismo archivo producia dos hashes distintos segun quien lo mirara y los overrides recien aceptados aparecian como stale. Ambos normalizan ahora.
- El interpolador de plantillas destruia las expresiones `${{ ... }}` de GitHub Actions: cualquier workflow instalado perdia sus referencias a `github.sha`, `steps.*.outputs` o `matrix.*` y llegaba roto al consumidor. `interpolate` las preserva y su validador deja de exigirlas como placeholders.
- `schemas/phase-evidence.schema.json` declara draft 2020-12 y Ajv 8 solo compila hasta draft-07 por defecto, asi que el primer intento real de validar evidencia fallaba con `no schema with key or ref`. Es la prueba de que ese schema nunca se habia compilado desde que empezo a instalarse en 1.5.0. Ademas los avisos de Ajv iban a stdout y corrompian el JSON del CLI.
- **Gate fantasma en `sdlc verdict`.** Los pasos se invocan con `--if-present` (npm/pnpm), que sale 0 cuando el script no existe, así que un paso BLOCKING no declarado por el consumidor se reportaba `pass` y contribuía a un `READY` falso. Verificado en un consumidor real: `validate:adr-integrity` (BLOCKING) y `validate:active-slices` aprobaban en verde sin existir. Ahora `commandVerdict` prechequea `package.json` y reporta `not-configured` (ni pass ni fail, no dispara el fail-fast), con la lista en el campo nuevo `notConfigured` del payload. Los consumidores sin `package.json` legible mantienen el comportamiento anterior.
- `src/runtime.js`: un `vaultRoot` relativo en `scripts/obsidian-memory.config.local.json` se resolvía contra el cwd del proceso y no contra el repo destino, así que invocar el CLI desde otro directorio producía un `vault-missing` engañoso. Ahora los paths relativos se resuelven contra el target.
- **El guard de frontera de especificación no se protegía a sí mismo (P2).** Tres huecos: un `locked-paths.txt` custom reemplazaba `DEFAULT_LOCKED` entero en vez de extenderlo; el propio script, su config y su allowlist no estaban en ninguna lista protegida; y sobre todo, en CI se ejecutaba la copia del guard que traía el propio PR, así que neutralizarla (`process.exit(0)`) bastaba para desactivar el control sin que ninguna lista ayudara. `quality-verify.yml` ahora corre la copia del guard que vive en la rama de integración, nunca la del checkout. `git diff` también era ciego a archivos nuevos sin `git add`; se agregó `git status --porcelain`.
- **Guard anti-regresión en F14, gap documentado y no resuelto en 1.11.0 (P7).** F14 (merge) no mide nada propio. `adjudicateFromEvidence` detecta gates HEREDADOS (`gate.phase != phase` que los declara) y los evalúa leyendo la evidencia de su fase de origen directamente, sin fabricar un mecanismo de arrastre. `phase-contract.yaml` F14 declara los gates en modo ratchet de F8/F10.
- **`sdlc quality-baseline --promote --source ci` no verificaba nada contra la evidencia real (P8).** El flag era pura afirmación del invocador: cualquiera podía correr `--source ci` localmente contra evidencia `harness` (nunca recomputada por el árbitro) y el baseline quedaba `promoted_by: ci`. Ahora se cruza `source==="ci"` contra `quality_metrics.source` de la evidencia y se rechaza si no coinciden.

### Added

- **Baseline versionado para gates `ratchet` (1.11.0).** `src/quality-baseline.js` + `sdlc quality-baseline --promote --slice <id> [--phase F15]`: mueve la linea base a lo que dice la evidencia YA ESCRITA de una fase, nunca a un numero pasado a mano. Sin `--source ci` exige `--allow-local` explicito. Cada promocion recalcula `integrity_sha256`; una edicion manual del archivo queda sin firma valida y `sdlc doctor` la reporta como `baseline-tampered` (error). `F8.changed-lines-coverage`, `F10.dependency-violations` y `F10.dependency-cycles` suben de `observe` a `ratchet` en el contrato por defecto.
- `.github/agent-state/quality-baseline.yaml` recibe el mismo tratamiento que `.sdlc/session.json`: no se instala por manifiesto porque `promoteBaseline` lo reescribe en runtime, y un archivo gestionado que otra ruta legitima reescribe produce drift permanente contra si mismo. Antes de la primera promocion no existe fisicamente.
- **`phase-contract.yaml` sube a version 2.** Cada fase puede declarar `quality_gates`, que referencian por id los gates de `quality-contract.yaml`: el contrato de fases dice QUE se exige y en que fase, el de calidad dice CUANTO por tier y COMO se mide. F8, F9 y F10 traen sus gates por defecto. Un contrato v1 sigue siendo valido y solo recibe el aviso `contract-version-outdated`, en vez de degradar en silencio.
- `sdlc status` gana el cuarto componente `quality`, adjudicado desde la evidencia sin ejecutar probes y marcado `advisory` cuando se midio en local. Un consumidor sin contrato de calidad obtiene `not-configured` y NO pasa a no-go por ello.
- **Arbitro de calidad en CI.** `templates/.github/workflows/quality-verify.yml` re-ejecuta los controles bloqueantes en un runner que el agente no controla y compara lo recomputado contra lo declarado. El harness local calcula lo mismo pero se autodeclara `advisory`: sin esa separacion, el veredicto lo firma el evaluado.
- **Frontera de especificacion.** `templates/scripts/validate-spec-boundary.mjs` bloquea (exit 2) cuando el diff toca specs, contratos, workflows o configuracion de herramientas sin excepcion declarada en `spec-boundary-allowlist.yaml`. Compara contra la rama de integracion REMOTA e incluye working tree y staged, para que sirva antes de que exista un commit. Sin este candado, la ruta mas barata para pasar cualquier gate es reescribir el criterio.
- `sdlc quality-gate --slice <id> --phase <F> <--run|--from-evidence>`: ejecuta los probes declarados en `quality-contract.yaml`, anexa la evidencia medida y adjudica. Los adapters de formato viven en el consumidor; el engine no conoce ninguna herramienta.
- `phase-gate` ABRE la evidencia. Hasta ahora solo comprobaba que el archivo existiera: un YAML vacio, corrupto o de cualquier forma pasaba igual. Ahora se valida contra el schema y, en fases con gate humano, se exige la firma.
- `schemas/quality-contract.schema.json` y `templates/quality-contract.yaml`: contrato declarativo del consumidor con tiers, superficies, probes, umbrales por tier, denominador minimo y modo de cada gate.
- Schema de evidencia ampliado de forma aditiva con `quality_metrics`, `scenario_traceability`, `verification` y `waivers`.
- **`sdlc upgrade` resuelve conflictos por archivo.** `--accept-managed <paths,coma>` y `--accept-all-managed` conservan la version local de los archivos gestionados que el consumidor personalizo a proposito, en vez de abortar el upgrade completo. Verificado contra un consumidor real con 57 archivos en conflicto: antes ningun upgrade era posible, ahora completa y el dominio queda intacto. Aceptar una ruta que no esta en conflicto es un error de uso explicito, no un no-op.
- `.sdlc/overrides.yaml`: registro versionado de las divergencias aceptadas (path, sha256, motivo, fecha y version del framework). `sdlc doctor` reclasifica esos archivos de `managed-file-drift` (warning anonimo) a `managed-file-override` (info), y emite `managed-file-override-stale` cuando el archivo cambia despues de aceptarlo. En el consumidor piloto, 57 warnings de drift pasaron a overrides declarados.
- `docs/research/2026-08-quality-gauntlet-agentic.md` y `docs/adr/0007-quality-gauntlet-f0-f17.md`: investigación y decisión para adoptar el gauntlet de calidad verificable (tests, Gherkin firmado, métricas estructurales, mutación y QA) sobre las fases F0-F17, con árbitro en CI, evidencia anexada por el harness y escalera observa → ratchet → absoluto.
- `scripts/validate-template-sanitization.mjs`: `docs/research/` entra en la allowlist junto a `docs/extraction/` y `docs/adr/`. La regla protege lo que se instala en un consumidor; la documentación interna que razona sobre consumidores reales no se instala.
- Casos de regresión para la detección de package manager (`packageManager`, lockfile y default), para el reporte de `tools-doctor` en un consumidor npm y para la entrega efectiva de los scripts de headroom. Caso adicional para la resolución de un `vaultRoot` relativo contra el repo destino.
- **Adapters reales de formato + `sdlc coverage-diff` (P1).** `templates/scripts/quality-adapters/{istanbul-summary,dependency-cruiser,stryker}.mjs` traducen reportes nativos a métricas normalizadas; antes solo existían fixtures falsos escritos por los tests. `src/coverage-diff.js` cruza `git diff` contra `coverage-final.json` para producir `coverage.changed_lines_pct` real. Sin esto toda métrica era `null` y todo gate `not-measured` en los tres consumidores del contrato.
- **Scripts de `package.json` anclados por hash (P3).** Nuevo campo `command_sha256` en los probes: `checkProbeAnchors` detecta si el script que corre un probe cambió sin pasar por revisión (el contrato ya está protegido por el guard de P2). Sin ancla, `doctor` avisa; con ancla, un mismatch bloquea siempre.
- **Detector real de `evidence-mismatch` (P4).** `src/quality-verify.js`: tras `quality-gate --run --source ci`, se compara lo que el harness local declaró contra lo recién medido quando el árbol de código es el mismo — la mitad del diseño de ADR 0007 D1 ("CI recomputa y compara") que nunca se había conectado.
- **Firma humana por signed-attestation (P5).** `src/signoff.js`: con un solo maintainer, GitHub prohíbe auto-aprobar tu propio PR — `platform-review` es insatisfacible. La firma se verifica por commit vacío firmado (`git verify-commit`) cuyo `subject_sha256` (slice+phase+tree_hash, siempre recomputado) coincide con lo que hay que aprobar. Nuevo `sdlc signoff --create/--verify` y `governance.maintainers` en el schema de config.
- **`quality-contract.yaml` generado desde `config.surfaces` (P6).** El template traía `apps/api`/`apps/web` hardcodeados, desconectados de la config real: un consumidor bien configurado terminaba con superficies inventadas bloqueando siempre. `config.surfaces[]` admite ahora `tier`/`moneyPath`/`hasUi`.
- **Artefacto OpenSpec `acceptance` con `sc_id` estable (P9).** `src/acceptance.js`: el id de escenario se deriva por hash de `(capability, requirement, título)` en vez de un contador secuencial que colisionaba entre autores paralelos. Nuevo `sdlc acceptance-verify --change <slug>`.
- **Prueba de rojo con crédito solo por aserción real (P10).** `src/red-proof.js`: `it('SC-001', () => { throw new Error('not implemented') })` era rojo gratis. Ahora se exige `outcome:assertion-failed` en el reporte del test runner (adapter de referencia para Vitest incluido) para que un escenario cuente como demostrado en rojo.
- **Cierre de change por hechos, no por checkbox (P11).** `src/change-closure.js`: ninguna tarea de `tasks.md` puede quedar sin marcar, una tarea de merge marcada `[x]` exige que `HEAD` sea antepasado real de la rama de integración, y las fases con gate humano deben mostrar su propia evidencia en `ok`. Nuevo `sdlc change-close`.
- **Los 8 `VERDICT_STEPS` con implementación real (P12).** `templates/scripts/validators/`: `control-plane`, `drift`, `slice-traceability`, `surface-traceability`, `semantic-guardrails`, `adr-integrity`, `openspec` y `active-slices` dejan de ser nombres de script que el consumidor debía escribir por su cuenta.
- **`sdlc adopt` (P13).** Reemplaza `npm link` para consumidores maduros que no quieren el scaffold completo de `sdlc install`: aditivo puro, nunca sobreescribe lo que ya existe. Agrega `sistema-multiagente-sdlc` como devDependency pinneada, `.sdlc/config.json` mínimo, `quality-contract.yaml` y `phase-contract.yaml` solo si faltan.
- **Documentación generada desde el contrato + política de retención (P14).** `sdlc quality-docs` regenera tiers/superficies/probes/gates directamente desde `quality-contract.yaml` y `phase-contract.yaml`. `src/retention.js` verifica que `.gitignore` nunca alcance a la evidencia permanente y avisa si los reportes efímeros no están ignorados.

## [1.7.1] — 2026-08-03

Mejoras extraídas de los consumidores `CMSHeadless` y `DemoMeridian`, donde el framework se instaló y se endureció en uso real.

### Fixed

- **Discovery de skills en Codex.** Los mirrors (`.claude/skills/`, `.agents/skills/`, `.windsurf/skills/`) anteponían un bloque `managed: true`, que tapaba el frontmatter real de la skill (`name`, `description`). Codex lee el **primer** bloque YAML como definición, así que ninguna skill gobernada era descubrible en Codex. Ahora el mirror conserva (o sintetiza) el frontmatter real como primer bloque y mueve la metadata de gestión al final como comentarios HTML. Afecta a `src/render.js` (ruta de `sdlc install`) y a `templates/scripts/bootstrap-agent-skills.ps1` (ruta de bootstrap), que producen bytes idénticos.
- `FRAMEWORK_VERSION` estaba hardcodeado en `1.6.0` en `src/render.js` mientras el paquete publicado era `1.7.0`; los repos instalados registraban una versión falsa en `.sdlc/config.json`. Ahora se lee de `package.json`, y `tests/run-regression.mjs` lo asserta contra la misma fuente en lugar de un literal.
- `migrations/1.7.0/`: la versión 1.7.0 se publicó sin entrada en el registro de migraciones, así que `sdlc upgrade` la rechazaba con "Version no soportada". Se agrega también `migrations/1.7.1/` para este release.
- `phase-contract.yaml`: F16-archive pedía `openspec/changes/<slice>` como `inputs_required`, rompiendo la cadena de evidencia que siguen F9–F15 y F17. Ahora pide `.github/agent-state/evidence/<slice>/F15.yaml`.

### Added

- `templates/scripts/validate-codex-skills.mjs`: valida que los tres mirrors conserven frontmatter real primero, metadata de gestión al final, hash de source igual al canónico y cuerpo UTF-8 equivalente. Enganchado en `validate-local-gate.ps1` después del bootstrap.
- `templates/scripts/validate-enhanced-research.mjs`: `validate-local-gate.ps1` ya invocaba este contrato pero el framework nunca lo entregaba. Exige change OpenSpec (activo o archivado) cuando el slice toca rutas de producto; los cambios solo operativos quedan exentos.
- Sección "Puente Codex" en `templates/AGENTS.md` y `templates/.github/AGENTS.md`: Codex no ejecuta slash commands nativos, así que `/continua`, `/resume` y `/save` se traducen a `npx --no-install sdlc ... --platform codex`. El resultado de `/continua` es vinculante ante `phaseGate.status:"blocked"` o `humanGate:true`.
- Regla "producción solo-crear" en `AGENTS.md`: sobre sistemas externos vivos solo se crean artefactos nuevos y aislados; modificar o borrar exige gate humano explícito.
- Recomendación de escanear `.github/skills/` antes del bootstrap, para no propagar una skill comprometida a los tres mirrors.

### Changed

- `templates/scripts/bootstrap-agent-skills.ps1`: lectura y escritura explícitas en UTF-8 sin BOM (Windows PowerShell 5.1 y PowerShell 7 producían mirrors distintos con tildes); nuevo `sdlc-body-sha256` que distingue "cambió el canónico" de "alguien editó el mirror a mano", evitando falsos positivos de drift; switch `-Force` para re-sellar; los mirrors en formato legacy se re-sellan en vez de bloquearse.
- `templates/scripts/validate-local-gate.ps1`: acepta `validate-enhanced-research.mjs` además del `.js` histórico, y corre `validate-codex-skills.mjs` tras el bootstrap.
- `templates/docs/guides/skills-multi-entorno.md`: documenta el formato de mirror y por qué, los dos hashes, el puente de comandos en Codex, y corrige los comandos de ejemplo (`-SkipRepoGovernedSync` no existe; la instalación de skills externas es opt-in con `-InstallExternal`).

## [1.7.0] — 2026-05-29

### Added

- ADR `0006-engine-harness-verdict-eval.md`: extensiones para Governance Engineering (P2–P4 del plan).
- `sdlc verdict`: veredicto único READY/NOT-READY con validators en orden fail-fast, clasificación BLOCKING/WARNING, exit 0/2. Opcional `--write --slice --phase` para artefacto en evidence/.
- `sdlc status`: snapshot go/no-go agregado (governance-check + tools-doctor + phase-gate). Flags `--markdown --write` (genera `status.md`) y `--exit-code` para CI hard-block.
- `sdlc phase-gate --exit-code`: flag que hace el chequeo bloqueante (exit 2 cuando "blocked"), con scoping correcto; sin el flag mantiene comportamiento informativo (exit 0) para compatibilidad P0.
- `src/eval-runner.js`: eval-runner determinístico para el loop de skills vivas (ADR-025 P4).
- `sdlc skill-eval --skill <nombre>`: evalúa golden tasks de `.github/skills/<skill>/evals/*.yaml`; emite score y detalles por task.
- `sdlc skill-propose --skill <nombre> --change <change> --intent "..."`: genera propuesta de edición de skill solo bajo `openspec/changes/<change>/`; nunca muta `.github/skills/` directamente.
- `schemas/skill-eval.schema.json`: schema JSON Schema draft-07 para sets de golden tasks.

### Changed

- `src/harness.js`: `commandPhaseGate` acepta `--exit-code` opt-in (retrocompatible).
- `src/cli.js`: despacha los nuevos comandos `verdict`, `status`, `skill-eval`, `skill-propose`; help string actualizado.

## [1.6.0] — 2026-05-26

### Added

- ADR `0005-tool-hierarchy-and-operational-profiles.md`: jerarquía de retrieval y perfiles `LEAN` / `ANALYSIS` / `ORCHESTRATION`.
- Guía `docs/guides/tool-hierarchy-and-profiles.md` y template instalable equivalente.
- Migración `1.6.0` con marcador `.sdlc/migrations/1.6.0-applied.txt`.
- Script template `scripts/validate-local-gate.ps1` para reproducir el control plane antes de push/PR.

### Changed

- `SDLC_SHARED_RULES` ahora incluye reglas 7-9 para jerarquía de retrieval, perfiles operativos y gate local pre-push/pre-PR.
- Skills `contexto-proyecto`, `enrich-us` y `party-mode` aplican selección de perfil y límites de herramienta.
- External tools matrix documenta perfil elegible y cuándo no usar cada herramienta.
- Workflows de GitHub Actions optan a Node 24 para evitar warnings de acciones JavaScript sobre Node 20.

## [1.5.0] — 2026-05-24

### Added

- Harness ejecutable F0-F17 con `phase-contract.yaml`, `schemas/phase-evidence.schema.json` y `templates/phases/F0...F17`.
- Comandos CLI nuevos: `sdlc phase-gate`, `sdlc governance-check`, `sdlc tools-doctor` y `sdlc pr-body-check`.
- Bloque `SDLC_SHARED_RULES` con hash para paridad entre `AGENTS.md`, `CLAUDE.md`, `.github/AGENTS.md` y `.github/copilot-instructions.md`.
- Roles upstream: `product-owner-agent`, `project-manager-agent`, `qa-test-architect-agent`, `tech-writer-agent` y `ux-designer-agent`.
- Skill `party-mode` anclada a F1/F2/F5 y separación entre QA temprana y `qa-security-review` para F9/F10.
- Perfil `full-harness` para reportar OpenSpec, Graphify, CodeGraph, Obsidian, Headroom, Caveman, autoskills, Vercel skills, party-mode y pnpm.
- Migración `1.5.0` con marcador `.sdlc/migrations/1.5.0-applied.txt`.

### Changed

- Migración del desarrollo y workflows del framework a `pnpm@11.3.0`.
- `resume` y `continua` incorporan lectura del contrato de fase y reportan bloqueos por evidencia faltante.
- `buildManagedFiles` genera mirrors cross-IDE desde `.github/skills/` para evitar drift entre Claude Code, Codex, Copilot y Windsurf.

### Tests

- Regresión extendida con smoke tests de `phase-gate`, `governance-check` y `tools-doctor`.

## [1.4.0] — 2026-05-24

### Added

- ADR `0004-codegraph-graphify-orden-canonico.md`: cierra la decisión pendiente de ADR 0002 y canoniza CodeGraph para estructura de código + Graphify para semántica documental/export Obsidian.
- Runtime Node multiagente como interfaz canónica: `sdlc session-start`, `resume`, `save`, `continua`, `memory-sync`, `validate-runtime` y `hooks install --post-merge-checkpoint`.
- `.sdlc/session.json` como estado generado de sesión para healthcheck y continuidad cross-IDE.
- Skills canónicas `resume`, `save` y `continua` bajo `.github/skills/` y mirrors para `.claude/`, `.agents/` y `.windsurf/`, todas apuntando al mismo CLI `sdlc`.
- `templates/scripts/continua.mjs` como implementación portable Node de continuidad; `continua.ps1` queda como wrapper Windows delgado.
- Migración `1.4.0` con marcador `.sdlc/migrations/1.4.0-applied.txt`.

### Changed

- `sdlc doctor` y el runner de regresión validan la versión `1.4.0`.
- El manifest de skills gobernadas incluye `resume`, `save` y `continua`.
- La continuidad multiagente deja de depender de PowerShell como runtime primario; PowerShell queda para compatibilidad en Windows.

### Tests

- Regresión extendida con smoke tests de `session-start`, `resume`, `save --no-mutate`, `continua`, `memory-sync --mode health`, `validate-runtime` y `hooks install`.

## [1.3.0] — 2026-05-23

### Added

- ADR `0002-codegraph-spike.md` (versión Propuesta inicial): aprobar evaluación de 7 días de [CodeGraph (colbymchenry)](https://github.com/colbymchenry/codegraph). Esta versión queda en el historial git; la versión vigente es la Aceptada del bloque "Changed" anterior.
- ADR `0003-per-phase-model-assignment.md`: extender `templates/scripts/models.yaml` con bloque opcional `phases:` para asignar modelos distintos a fases SDD (`sdd-explore`, `sdd-design`, `sdd-implement`, `sdd-review` o F0-F17). Reduce costo en exploración manteniendo precisión en F2-F3. Inspirado por el patrón `--profile-phase` de `gentle-ai`.
- `templates/scripts/models.yaml`: bloque `phases:` opt-in con defaults documentados (Haiku para `sdd-explore`, Opus para `sdd-design`, Sonnet para `sdd-implement`/`sdd-review`).
- Skill `edge-case-hunter`: checklist portable para revisar entradas límite, concurrencia, fallos parciales, dependencias, autorización y volumen antes de implementación.
- `analista-requisitos.agent.md`: protocolo de elicitación avanzada para historias ambiguas antes de pasar a diseño.

### Changed

- ADR `0002-codegraph-spike.md` cambia de estado **Propuesta → Aceptada**. Se reemplaza la estrategia de "spike 7 días con benchmarks sintéticos obligatorios" por **"instalar y observar"**: la adopción es coexistencia con Graphify desde el día 1, sin slice dedicado, y la verificación del ahorro de tokens claimado por CodeGraph (94 % menos tool-calls según su README) se hará por observación natural durante varias sesiones reales. El ADR ahora documenta:
  - Reglas concretas de coexistencia (Graphify-first para razonamiento humano y `enrich-us` 4.5; CodeGraph vía MCP para queries estructurales runtime).
  - Triggers para abrir ADR 0004 (evidencia de ahorro real, cobertura de rutas framework, o costo operativo excesivo).
  - Implementación operativa ya ejecutada en `FacturacionDian` con scope narrow (`apps/**/src` + `packages/**/src`, `.ts/.tsx`) para evitar el OOM del index default sobre un monorepo grande.
  - Métricas del index inicial sobre `FacturacionDian`: 658 archivos, 7.954 nodes, 14.869 edges, 14.48 MB native SQLite.
- `scripts/validate-models-schema.mjs`: soporte para clave top-level `phases` opcional + verificación de shape `{ primary, fallback }` por fase. Bloque `phases:` declarado pero vacío produce error explícito.

### Docs

- README: actualizada tabla `BMAD Comparison` con realidad V6 de BMAD-METHOD (module ecosystem BMM/BMB/TEA/BMGD/CIS, Skills Architecture, Sub-Agent inclusion, scale-adaptive, Discord community) y comparación side-by-side honesta. Datos tomados del README oficial v6 de `bmad-code-org/BMAD-METHOD`.
- README Roadmap v1.3.0: agregadas entradas `macos-latest` para `regression-install` matrix y bump de `actions/checkout@v5` + `actions/setup-node@v5` con `node-version: 24` antes del deprecation deadline de GitHub (Node 20 deprecated jun 2026, removed sep 2026).

## [1.2.1] — 2026-05-18

### UX fix — `init` sin `--target` usa cwd

- `bin/sdlc.js` (`src/cli.js`): `requireTarget` deja de exigir `--target <repo>`. Cuando se omite, se usa `process.cwd()` como destino.
- El quickstart del README (`npx sistema-multiagente-sdlc init --dry-run`) ahora coincide con el comportamiento real del CLI; antes fallaba con `Falta --target <repo>`.
- Mensaje de `help` actualizado: `--target` queda marcado como opcional con default cwd.
- Regresión nueva en `tests/run-regression.mjs`: smoke test ejecuta `node bin/sdlc.js init --dry-run` desde un tmpdir con `cwd` distinto al repo y verifica que el dry-run no escriba archivos.
- Sin cambios en `frameworkVersion` (sigue `1.2.0`): no se altera el contenido de los archivos gestionados, solo el front-door del CLI. Las instalaciones existentes no requieren `upgrade` ni migración.

## [1.2.0] — 2026-05-17

### Phase 1 — Versionado y migraciones

- Prepara metadata npm publica para `sistema-multiagente-sdlc`.
- Actualiza `frameworkVersion` a `1.2.0`.
- Reserva `scale` en config (`bug`, `feature`, `epic`, `platform`) para adaptive scale de v1.3.0.
- Agrega targets de migracion `1.1.0` y `1.2.0` para cubrir upgrades `1.0.0 -> 1.2.0` y `1.1.0 -> 1.2.0`.

### Phase 2 — Scripts operativos

- Reemplaza stubs por 12 scripts sanitizados en `templates/scripts/`.
- Agrega politica opt-in: `publish-trace` y scheduler requieren `-Apply`; sync externo requiere flags explicitos.
- Instala `agent-skills.manifest.json`, `models.yaml` routing-only y config ejemplo de memoria Obsidian.
- Amplia regresion con pruebas golden para `continua`, `publish-trace`, `register-claude-sync-task`, `compute-calibration` y `bootstrap-agent-skills`.

### Phase 3 — C5/C6 skills

- Agrega stack-skills canonicas `backend-audit` y `ui-ux-diseno` bajo `.github/skills`.
- Agrega scaffolds de mirrors `.claude/skills`, `.agents/skills` y `.windsurf/skills`.
- Extiende `stack` con `database` y `designSystem` para las nuevas skills parametrizadas.

### Phase 4 — Gobierno operativo

- Enriquece `.github/agent-state/` con `phase-status`, `active-slices`, decisiones, riesgos, lock TTL, drafts, calibration y templates de rework/handoff.
- Fortalece `phase-graph.yaml` con rework label-driven, `F3_5` tecnico y `F3.5` display.
- Agrega personas `.agent.md` validables, README de agentes y trazabilidad/guardrails genericos.

### Phase 5 — Docs operativas

- Agrega `docs/agents/` con presentacion F0-F17, catalogo de comandos, triage labels, mapa de handoffs, stack map y dominio base.
- Documenta la instalacion opt-in de Obsidian, Graphify, caveman y sync de memoria en `external-tools-matrix.md`.
- Agrega matriz de trazabilidad por superficie y guardrails semanticos genericos.

### Phase 6 — OpenSpec specs base

- Instala specs canonicas `business-production-readiness` y `project-phases`.
- Deja specs donor especificas como referencia educativa no instalada en `docs/examples/openspec-specs-ejemplos/`.

### Phase 7 — Validators

- Agrega 9 validators nuevos: placeholder scripts, politica de herramientas externas, precedencia de gobierno, consistencia de skills, schema de personas, links docs, OpenSpec, Mustache y `models.yaml`.
- `pnpm run validate` ahora ejecuta 14 validators en cadena.

### Phase 8 — Doctor

- `sdlc doctor` reporta runtime Node, PowerShell y Git.
- Verifica agent-state base, specs canonicas, manifest de skills y `scale`.
- Reporta Obsidian, Graphify y mirrors como checks informativos cuando siguen opt-in.

### Phase 9-11 — E2E, community y CI/CD

- Agrega alias `sdlc init` para `sdlc install` y prueba de regresion `init-alias`.
- Expande README con quick start `npx`, flujo F0-F17, validators, matriz BMAD y roadmap.
- Agrega workflows `regression-install`, `release` y `publish` manual con provenance.

## [1.1.0] — 2026-05-18

### Fase A — Template engine

- Externaliza contenido inline a `templates/` con manifest selectivo (`templates/manifest.yaml`).
- Motor logicless Mustache (`interpolate()`); placeholders `{{project.name}}`, `{{project.slug}}`, `{{mode}}`, `{{stack.*}}`, `{{gitFlow.*}}`, `{{obsidian.*}}`, `{{surfaces.*}}`.
- Ningún template usa extensión `.mustache`; todos los archivos se interpolan al instalar.

### Fase H — AJV schema-driven config validation

- Validador de config basado en AJV; `config-schema.json` governa el contrato de entrada.
- `validate:config-schema` corre antes de cualquier `install/upgrade`.

### Fase E — Sistema de migraciones dinámico

- `migrations/` con migraciones versionadas; `upgrade` y `rollback` con backup automático.
- `doctor` detecta drift entre versión instalada y versión del framework.

### Fase B — Extraction manifest

- `docs/extraction/v1.0.0/extraction-manifest.yaml`: catálogo auditado de 75 entries (C1–C9 activos + C5–C6 diferidos + exclusiones).
- Bloquea walk ciego de `templates/`; solo entradas explícitas en manifest se instalan.

### Fase C — Template extraction (C1→C9)

**C1 — Governance:**
- `templates/AGENTS.md`, `templates/.github/AGENTS.md`, `templates/CLAUDE.md`, `templates/indice-operativo.md`.

**C2 — Agent personas (7 activos):**
- `planificador-opus`, `orquestador-opus`, `analista-requisitos` (legacy), `arquitecto`, `api-agent`, `web-agent`, `qa-security-review`.
- Sanitizados: domain-specific refs (DIAN, FacturacionDian, Samcol) eliminadas; stack refs parametrizadas con `{{stack.backend}}`/`{{stack.frontend}}`.

**C3 — Copilot instructions:**
- `copilot-instructions-greenfield.md` (mode: greenfield), `copilot-instructions-legacy.md` (mode: legacy).
- Ambos apuntan al mismo target `.github/copilot-instructions.md` según mode activo.

**C4 — Core skills (18 archivos, 19 entries en extraction-manifest):**
- `contexto-proyecto` (claude + github), `orquestacion-multiagente`, `enrich-us` (claude + github), `commit` (claude + github).
- OpenSpec skills: `propose`, `explore`, `apply`, `archive`, `verify`, `sync`, `ff`, `new`, `continue`.
- `documentacion-viva`, `operacion-cli-devops`.

**C7 — OpenSpec schemas:**
- `legacy-brownfield-sdd/`: `schema.yaml` + 5 templates (research, proposal, specs, design, tasks). Mode: legacy.
- `greenfield-sdd/`: `schema.yaml` + 4 templates (proposal, specs, design, tasks). Mode: greenfield. New, no donor.
- Profiles: `minimal.yaml`, `expanded.yaml`.
- Scaffolds: `openspec/specs/.gitkeep`, `openspec/changes/.gitkeep`, `openspec/specs/business-production-readiness/README.md`.
- Config mode-specific: `openspec/config-greenfield.yaml`, `openspec/config-legacy.yaml`.

**C9 — Docs guides:**
- `adopcion_openspec_sdd.md`, `business-production-readiness.md`, `memoria-persistente-multiagente.md`, `skills-multi-entorno.md`.
- Sanitizados: paths específicos → `{{obsidian.memoryWorkspace}}`, `{{project.slug}}`; ejemplos domain-specific → genéricos.

### Diferidos → v1.2.0

- **C5** Stack skills (11): nestjs, nextjs, react, prisma, turborepo, vitest, playwright, tailwind, vercel, accessibility, bash-defensive-patterns.
- **C6** Skill mirrors (3): `.agents/skills/`, `.windsurf/skills/`, `.cursorrules`.

---

## [1.0.0] — 2026-05-11

Lanzamiento inicial del framework reusable extraído de `FacturacionDian` (commit `f1e7acafe7`).

- CLI `sdlc install/upgrade/rollback/doctor/diff/prune-backups`.
- Template engine con manifest selectivo.
- AJV config validation.
- Migration system con backup automático.
- Extraction manifest v1.0.0 con catálogo completo de 75 entries.
