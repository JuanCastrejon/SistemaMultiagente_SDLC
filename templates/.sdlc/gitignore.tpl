# Gestionado por SistemaMultiagente_SDLC.
#
# El vault es memoria de trabajo de ESTA maquina: checkpoints de continuidad,
# no documentacion del proyecto. Versionarlo mezclaria contexto personal de
# sesion con la fuente de verdad del repo, y ademas arrastraria al historial
# cosas que un checkpoint recoge sin filtrar (rutas locales, estado de runtime,
# y en el peor caso menciones a secretos).
#
# Lo que SI debe versionarse es la decision ya promovida: un ADR, una spec en
# openspec/, o documentacion en docs/. Si algo del checkpoint importa a largo
# plazo, se promueve ahi — no se commitea el checkpoint.
vault/

# Estado local de maquina, no del proyecto.
session.json
patch-plan.json
backups/
