# Regras auditadas do motor comercial

## Regras de identificação e justificativa

- **Orçamento pendente:** só `quotes.status = pending` gera oportunidade `pending_quote`. `accepted` significa orçamento aceito, não prova de venda; `declined`, `expired` e `cancelled` não são pendências. Venda só existe quando a equipe registra `sale_confirmed` com valor e evidência.
- **Data do orçamento:** `issued_at` ausente/inválida impede calcular idade e vai para revisão, sem oportunidade inventada.
- **Datas futuras:** emissão ou atendimento no futuro vai para revisão; não gera recomendação acionável.
- **Prioridade do orçamento:** alta se vencido ou com 7+ dias; média com 2–6 dias ou valor >= R$ 1.000; baixa nos demais casos. Dado ambíguo/incompleto rebaixa uma faixa, nunca aumenta prioridade.
- **Acompanhamento:** atendimento só gera `overdue_follow_up` se estiver `completed` e tiver de 2 a 179 dias. `scheduled`, `cancelled` e `no_show` não geram. Alta em 7+ dias, média em 2–6.
- **Cliente inativo:** exige ao menos um evento com data válida, sendo o mais recente um atendimento concluído há 180+ dias; qualquer orçamento/atendimento posterior ou evento sem data bloqueia a conclusão. Prioridade média de 180–364 dias e alta a partir de 365; ambiguidade reduz uma faixa.
- **Vários orçamentos do mesmo cliente:** cada oportunidade pertence ao ID próprio do orçamento. Não consolidar valores entre orçamentos nem deduplicar pelo cliente.
- **Importação repetida:** a chave de oportunidade é clínica + categoria + tipo/id do evento de origem. O mesmo orçamento não gera nova oportunidade na mesma clínica; outra clínica fica isolada.
- **Mudança após geração:** se o orçamento deixa de estar pendente, ou o atendimento deixa de ser concluído/qualificar, a oportunidade aberta é encerrada como inválida com histórico. Aceitação nunca é convertida automaticamente em venda. Cliente com atividade mais recente perde oportunidade de inatividade.
- **Finanças:** valor potencial soma apenas oportunidades pendentes/em contato, uma vez por orçamento; não é receita. Receita confirmada exige evento `sale_confirmed` e evidência única. Receita atribuída permanece zero sem vínculo causal documentado.

## Os 20 casos sintéticos

A fixture `tests/fixtures/intelligence-20-cases.mjs` fixa a data de referência em 19/10/2026 e aplica os limiares acima. O resultado esperado de cada linha decorre diretamente da regra indicada, não de exemplos de conversão ou de valores previstos.

| Caso | Cenário | Resultado justificado |
|---|---|---|
| 01 | Pendente há 1 dia | Baixa: registro recente, abaixo do limiar de 2 dias/valor. |
| 02 | Pendente há 2 dias | Média: atingiu limiar temporal. |
| 03 | Pendente há 7 dias | Alta: atingiu limiar de atraso. |
| 04 | Pendente com vencimento passado | Alta: prazo vencido. |
| 05 | Aceito | Excluído de pendência; aceitação não prova venda. |
| 06 | Recusado | Excluído de pendência. |
| 07 | Status expirado | Excluído de pendência; não está aguardando resposta. |
| 08 | Cancelado | Excluído de pendência. |
| 09 | Pendente sem emissão | Revisão; idade indeterminável. |
| 10 | Pendente sem valor | Oportunidade média pela idade de 9 dias, confiança reduzida por valor ausente. |
| 11 | Antigo e ambíguo | Base alta rebaixada a média. |
| 12 | Dois orçamentos de um cliente | Duas oportunidades distintas, uma por ID de orçamento. |
| 13 | Mesmo orçamento importado duas vezes | Uma oportunidade após deduplicação pela chave de evento. |
| 14 | Mesmo ID em clínicas diferentes | Dois registros; deduplicação não atravessa tenant. |
| 15 | Atendimento agendado | Excluído; não está concluído. |
| 16 | Concluído há 1 dia | Sem acompanhamento; abaixo de 2 dias. |
| 17 | Concluído há 2 dias | Acompanhamento médio. |
| 18 | Concluído há 7 dias | Acompanhamento alto. |
| 19 | Concluído sem data | Revisão; atraso indeterminável. |
| 20 | Concluído há 180 dias | Inatividade; não duplica como acompanhamento atrasado. |

A fixture é sintética porque a planilha de 20 linhas mencionada não está versionada nem anexada a este projeto. Não afirma reproduzir os registros privados importados.
