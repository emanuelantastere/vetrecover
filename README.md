# VetRecover

SaaS B2B de inteligência comercial para clínicas veterinárias brasileiras. Complementa os sistemas de gestão existentes e não substitui um ERP.

## Base implementada

- Supabase Auth com cookies SSR via `@supabase/ssr`, clients separados para servidor e navegador e `src/proxy.ts` para atualizar/verificar sessão no Next.js 16.
- Cadastro com e-mail, senha e nome da clínica. Um trigger cria a clínica e o primeiro vínculo `owner`; membros não podem inserir vínculos pelo client.
- Página inicial protegida. O servidor confirma o usuário com `auth.getUser()`, consulta a associação à clínica e só então carrega dados. O RLS repete o isolamento no PostgreSQL.
- Migração com clínicas, membros, imports, clientes, pets, orçamentos, atendimentos, oportunidades e histórico de ações. Chaves estrangeiras compostas por `clinic_id` bloqueiam referências cruzadas entre clínicas.
- O dashboard mantém a identidade visual e agora só exibe registros reais. Indicadores sem dados aparecem como `—`; estados sem sessão, conexão, migração, clínica e dados vazios são explícitos.
- A importação aceita CSV e XLSX, apresenta mapeamento/prévia, e persiste linhas somente após confirmação. A migração `202610190002_import_pipeline.sql` adiciona rastreabilidade por linha e a gravação transacional com RLS. O arquivo original não é armazenado; seu nome e tipo ficam no histórico.
- Vendas não são inferidas de orçamentos ou atendimentos. Receita confirmada continua dependendo de registro explícito no histórico de ações.

## Ativar Supabase

1. Crie um projeto Supabase e copie a **Project URL** e a **publishable key** em Project Settings → API Keys.
2. Copie `.env.example` para `.env.local` e preencha apenas estes valores:

   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://SEU-PROJETO.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   ```

3. Se as tabelas-base (clínicas, membros, imports, clientes, pets, orçamentos, atendimentos e oportunidades) já existem, aplique `supabase/migrations/202610190002_import_pipeline.sql` no SQL Editor. Ela adiciona o registro por linha e a função transacional usada ao confirmar uma importação. Não execute antes de a migração que criou essas tabelas-base.
4. Em Authentication, habilite Email e defina a senha mínima como 12 caracteres. Em URL Configuration, configure o site local como `http://localhost:3000` e adicione `http://localhost:3000/auth/callback` aos Redirect URLs. Em produção, cadastre os domínios equivalentes.
5. Salve `.env.local`, reinicie o servidor (`npm run dev`) e crie uma conta na tela de login. Se confirmação de e-mail estiver ativa, confirme o endereço antes de entrar.

Para produção, cadastre essas duas variáveis no ambiente de build/deploy antes de compilar a aplicação; variáveis `NEXT_PUBLIC_` são incorporadas ao bundle durante o build. Configure também o domínio de produção em Auth → URL Configuration e mantenha confirmação de e-mail e a política de senha de 12 caracteres alinhadas ao ambiente.

O projeto não precisa de `service_role`, secret key nem credenciais privilegiadas: as consultas usam o JWT do usuário e RLS. Não crie essas variáveis no frontend. `.env.local` está excluído do Git; `.env.example` contém apenas nomes sem valores reais.

## Modelo de segurança

RLS está habilitado em todas as tabelas expostas. Helpers `SECURITY DEFINER` com `search_path` vazio consultam o vínculo sem recursão das políticas. Inserção de clínica/vínculo acontece pelo trigger de cadastro; o client autenticado só pode ler vínculos. Ações de histórico não podem ser inseridas/alteradas pelo client nesta etapa; quando forem implementadas, deverão usar ação de servidor/RPC com autorização por clínica. O Proxy renova a sessão e faz a verificação otimista; a página também valida usuário e vínculo no servidor. A proteção definitiva dos dados fica nas políticas SQL.

## Desenvolvimento e validação

```bash
npm install
npm run dev
npm test
npm run lint
npm run build
```

Os testes Node cobrem arquivos CSV/XLSX, validações, duplicidades e contratos estruturais de segurança/transação. A migração precisa ser aplicada no projeto Supabase antes do uso; os testes locais não substituem a validação integrada com dois usuários/clínicas nesse banco.

## Motor de Inteligência Comercial

A migração `supabase/migrations/202610190003_commercial_intelligence.sql` adiciona a identificação determinística de orçamentos pendentes, acompanhamentos de atendimentos concluídos e clientes inativos quando as datas importadas permitem essa conclusão. As oportunidades persistidas exibem prioridade e regra, valor/origem, motivo, próxima ação, data/origem dos dados e histórico.

Para ativar, aplique primeiro a migração `202610190002_import_pipeline.sql` e depois `202610190003_commercial_intelligence.sql` no SQL Editor do Supabase. A última migração interrompe a aplicação se encontrar oportunidades duplicadas por evento; revise esses registros antes de reaplicar.

Ações de oportunidade são registradas pelo servidor autenticado e limitadas à clínica do usuário. Marcar como venda concluída exige valor e referência de evidência; o motor não infere venda a partir de orçamento/atendimento e não atribui receita sem relação causal documentada. Os testes locais não substituem uma validação de integração com dois usuários de clínicas distintas no Supabase.

## Auditoria da inteligência comercial

A migração `202610190004_intelligence_reconciliation.sql` depende da migração 003 e deve ser aplicada depois dela. Ela reconcilia oportunidades abertas com o status atual do orçamento/atendimento, registra fechamentos automáticos no histórico, distingue acompanhamento atrasado de inatividade, e expõe notas de qualidade dos dados. O dashboard usa a RPC atual de totais; não cai na função financeira legada se a nova RPC falhar.

A regra e os 20 casos sintéticos estão documentados em `docs/intelligence-rules.md`. A planilha fictícia importada na instância não está incluída no projeto, então a fixture não reproduz nem acessa esses dados. A validação automatizada é local; a integração com Supabase só pode ser afirmada após aplicar a migração 004 e testar com contas/clínicas isoladas.

## Ciclo de gestão das oportunidades

A migração `supabase/migrations/202610190005_opportunity_lifecycle.sql` amplia o ciclo com tentativas de contato, falta de resposta, retorno agendado e observações. `waiting_reply` representa aguardando retorno; estados existentes mantêm seus significados. Cada evento exige identificador idempotente e é gravado em `action_history` com o usuário autenticado. Para usar os novos eventos, aplique a migração 005 depois das migrações 001 a 004 no SQL Editor do Supabase.

A conversão exige valor e referência de evidência; perdas e invalidações exigem justificativa. Valor potencial continua separado de receita e aguardando retorno permanece nos totais de oportunidades ativas. A interface não fornece uma identidade amigável do ator; exibe apenas um identificador curto da conta por privacidade.

## Central de oportunidades

A central lista os registros persistidos, permite filtrar por status/prioridade, buscar e ordenar, e registra eventos no histórico da oportunidade. A aba Resultados mostra contagens de oportunidades trabalhadas e perdas pelos motivos gravados pela equipe; os totais financeiros continuam deduplicados e separados entre potencial, negociação e vendas com evidência.

Aplique a migração `202610190006_opportunity_write_security.sql` depois da 005. Ela mantém leitura por membro da clínica, remove mutações diretas em oportunidades/histórico e eleva somente a RPC existente de confirmação de importação, mantendo a verificação do usuário e da clínica. Os testes locais não substituem a conferência de RLS e fluxos de ponta a ponta no projeto Supabase conectado.
