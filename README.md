# Futebol de Sexta

Aplicativo do grupo Futebol de Sexta.

Consulte [LEIA-ME.txt](./LEIA-ME.txt) para configurar e usar o app. O CRUD
administrativo de jogadores requer a migracao [MIGRACAO_CRUD_JOGADORES.sql](./MIGRACAO_CRUD_JOGADORES.sql)
no Supabase, depois dos SQLs-base e de `COMPLEMENTO_SUPABASE.sql`. Para gerar
novamente links individuais pelo painel, execute também
[MIGRACAO_LINKS_JOGADORES.sql](./MIGRACAO_LINKS_JOGADORES.sql). Para habilitar
a exclusão permanente no CRUD, execute
[MIGRACAO_EXCLUIR_JOGADORES.sql](./MIGRACAO_EXCLUIR_JOGADORES.sql) depois da
migração de notificações push. O app também
pode ser instalado pelo Chrome quando publicado em HTTPS. Após abrir o link
individual, o ícone do app abre a área do jogador com o acesso salvo no mesmo
perfil do navegador. Notificações push requerem executar
[MIGRACAO_NOTIFICACOES_PUSH.sql](./MIGRACAO_NOTIFICACOES_PUSH.sql), configurar
segredos e publicar a Supabase Edge Function `notificar-push`; o passo a passo
está em [LEIA-ME.txt](./LEIA-ME.txt).
