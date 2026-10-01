# Análise de resultados implementada

O CSV da Trade Republic é a única fonte de novos movimentos financeiros. A
aplicação continua a processar e guardar os dados localmente. Preços,
configurações e flags legados são preservados no backup, sem serem necessários
para os novos resultados realizados.

## Contrato contabilístico

Uma operação realizada é uma venda, resgate ou extinção registada. Uma venda
que consome vários lotes FIFO conta uma vez; duas vendas parciais contam duas
vezes. O motor calcula FIFO no histórico completo antes de filtrar o período
inclusivo. `Row.date` determina o dia do calendário; `datetime` determina a
ordem e aparece no detalhe. O desempate conserva a ordem estável dos movimentos
no histórico. Na fixture existente de 903 movimentos, as datas do extrato e
as datas UTC coincidem em todos os movimentos.

O resultado líquido é receita bruta menos custo bruto FIFO, encargos de
aquisição atribuídos e encargos de saída registados. Os sinais de estornos são
preservados. Não se estimam impostos pessoais futuros. Dividendos e juros
líquidos são apresentados separadamente; depósitos, levantamentos e consumo
permanecem movimentos de caixa.

Vendas sem aquisição conhecida não comprovam posições curtas. A nova análise
assinala custo desconhecido e resultado completo indisponível, exclui a
operação das métricas de sucesso e expõe o subtotal dos lotes conhecidos no
detalhe. O cartão soma apenas operações integralmente conhecidas. O motor
legado conserva a contabilização provisória para auditoria; coberturas de
quantidades negativas não são tratadas como ganhos válidos na nova análise.
Liquidações após uma extinção documentada reconhecem o recebimento posterior
uma única vez, sem descontar novamente o custo já reconhecido.

As operações são classificadas depois do arredondamento a cêntimos. Zeros
entram no denominador da taxa de ganhos. Sem operações válidas, a taxa e o
resultado médio ficam indisponíveis; sem perdas, o profit factor é
indisponível. A soma dos resultados arredondados das operações coincide com a
série diária, cartões, ponto final da curva e CSV analítico. Os componentes
FIFO mantêm precisão. A auditoria legada soma valores brutos antes de
arredondar; quando daí resulta uma diferença de cêntimos, a cobertura e o PDF
expõem essa diferença. Exemplo testado: três vendas de €40 de uma compra de
€100 / 3 unidades produzem €20,01 na apresentação por operação e €20,00 no
agregado bruto legado. Os snapshots contabilísticos não foram alterados para
ocultar diferenças.

## Consulta e projeções

O seletor comum controla cartões, curva diária, barras, calendário, histórico
e exportações. Dias sem realização, resultado zero e custo incompleto são
distintos. O calendário abre o histórico diário e o detalhe mostra os lotes
FIFO e custos; fechar o detalhe conserva pesquisa, página, mês e foco.
O histórico de movimentos inclui todos os movimentos, com pesquisa e
paginação, sem o antigo limite de 50.

A primeira e última data de movimentos não provam cobertura integral.
A comparação explicita o período anterior equivalente e a limitação de
cobertura. Não são reconstruídos valores históricos de mercado, P&L não
realizado histórico, TWR, benchmarks ou rendibilidade percentual da carteira.
A auditoria e fiscalidade legadas identificam o seu âmbito de histórico
completo / ano fiscal, separado da consulta de resultados.

As duas extrapolações automáticas usam o histórico disponível do último ano
importado e uma janela recente de até 60 dias. A referência é o último
movimento importado, não a data atual. Cada cenário mostra datas, dias com
realização, componente observada, componente extrapolada, fórmula e hipótese
de cobertura não comprovada. São necessários 30 dias de observação e 10 dias
com realização; custo desconhecido no ano desativa ambos. Anos encerrados
apresentam apenas o observado. Não se usam frequência manual, intervalos de
confiança ou cenários otimista/pessimista.

## Importação, armazenamento e recuperação

O ledger versionado conserva o CSV original, cabeçalhos, células e campos
desconhecidos, com referências de proveniência e identidades internas por
ocorrência. O ID original do intermediário continua disponível.

- IDs equivalentes são ignorados; conteúdo incompatível bloqueia o incremento.
- Reordenação dos cabeçalhos não é conflito. Mudanças do conjunto de colunas
  exigem reexportação e substituição integral: política conservadora explícita.
- Ocorrências anónimas iguais no mesmo ficheiro são preservadas. Reimportação
  exata é reconhecida. Sobreposição temporal anónima ambígua é bloqueada com
  instrução para reexportar o histórico completo.
- Ausências em extratos parciais não eliminam movimentos anteriores.
- Substituição integral, restauro e recuperação publicam uma revisão completa.
  Configurações, preços com datas, tickers e flags pertencem à mesma revisão.

As mutações são serializadas. O armazenamento publica uma geração imutável,
confirma a leitura, e só então publica um dos dois manifestos alternados.
A recuperação aceita apenas gerações referenciadas por manifestos validados;
gerações preparadas sem publicação são ignoradas. A revisão anterior permanece
recuperável. A API só atualiza a memória depois da publicação verificada.
Ficheiros legados permanecem intactos durante a migração. Erros de leitura não
são confundidos com ausência de ficheiro: no adaptador Android instalado, o
código `OS-PLUG-FILE-0008` identifica a ausência.

O Filesystem nativo não oferece uma transação atómica sobre vários ficheiros.
O protocolo assegura uma geração validada recuperável sob escritas parciais,
quota e interrupção; falhas arbitrárias simultâneas de leitura, publicação e
rollback não permitem prometer que a revisão mais recente será recuperada.

O backup próprio inclui o histórico integral e estado legado, independentemente
do período. A chave Finnhub é excluída e a chave local é preservada no restauro.
Versão, proveniência, limites, preços/datas, configurações e valores finitos do
cálculo são validados antes de persistir.

## API e exportação

Rotas novas: `results`, `realizations`, `movements`, `automatic_projection`,
`analysis_csv`, `backup`, `backup_restore` e `recover_previous`.
As consultas aceitam `start`, `end` e, onde aplicável, `search`, `page` e
`page_size`. A revisão acompanha a resposta; uma revisão solicitada obsoleta
devolve HTTP 409. Respostas atrasadas são ignoradas pela interface.

O PDF usa uma cópia congelada da análise selecionada e inclui período,
revisão, origem, definição de líquido, cobertura e totais diários. Não inclui
projeções. O CSV analítico exporta as realizações do período com componentes
de custos e protege células de texto contra fórmulas de folhas de cálculo.
O CSV fiscal conserva seleção de ano e contrato próprios. O backup JSON é o
artefacto restaurável; PDF e CSV analítico são relatórios.

## Validação

Baseline real: 207 testes passaram. Validação final: 246 testes passaram, sem
falhas; `npx tsc --noEmit`, `npm run build:web`, `node --check web/dashboard.js`
e `git diff --check` passaram. Foram acrescentados testes comportamentais
de FIFO, comissões/impostos/estornos, custo incompleto, datas, filtros,
paginação, projeções, identidade, sobreposição, falhas/quota/concorrência,
migração, recuperação, backup, CSV e geração real de PDF congelado.

No browser, a fixture de 903 movimentos foi importada pelo seletor de ficheiro.
Agosto de 2026 até dia 14: 34 realizações, €375,36 líquidos conhecidos; dia 14:
3 realizações, €284,60. Foram verificados calendário → lista → detalhe FIFO,
regresso com foco, pesquisa, páginas, estado vazio e persistência após reload.
O restauro pelo seletor de ficheiro publicou a revisão 2 e reproduziu os totais.
360 px, 390 px e paisagem 844 × 390 mantêm sete colunas e detalhe sem scroll
horizontal. O PDF de agosto foi gerado, extraído e renderizado para inspeção
visual; período, revisão congelada e total foram confirmados.

O APK debug foi compilado com sucesso com o SDK/JDK locais do repositório.
`adb devices -l` não encontrou dispositivo nem emulador: importação, partilha
e persistência no Android real continuam por validar.
