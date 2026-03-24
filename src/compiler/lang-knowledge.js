// lang-knowledge.js — Comprehensive language knowledge base for Senior HCM rule language
// This is THE canonical reference an AI uses to write correct Senior rule code.

// ─────────────────────────────────────────────────────────────────────────────
// RESERVED WORDS
// ─────────────────────────────────────────────────────────────────────────────
export const RESERVED_WORDS = [
  // Declaration
  'Definir', 'Numero', 'Alfa', 'Data', 'Cursor',
  // Function
  'funcao',
  // Control flow
  'Se', 'Senao', 'Enquanto',
  // Block delimiters
  'Inicio', 'Fim',
  // Logical operators
  'e', 'ou',
  // Message types
  'Retorna', 'Erro', 'Alerta',
  // File modes
  'Gravarnl', 'Lernl',
  // Cancel
  'Cancel',
];

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM VARIABLES
// ─────────────────────────────────────────────────────────────────────────────
export const SYSTEM_VARIABLES = [
  { name: 'VerWeb',       type: 'Numero', description: 'Execution context: 0 = desktop client, 1 = web (CSWeb/RSWeb)' },
  { name: 'datsis',       type: 'Data',   description: 'System date (current date from the server)' },
  { name: 'MenLog',       type: 'Alfa',   description: 'Log message output — assign a string to write to the system log' },
  { name: 'NumEmp',       type: 'Numero', description: 'Current company number (context of the executing rule)' },
  { name: 'TipCol',       type: 'Numero', description: 'Employee type (1=Employee, 2=Third-party, 3=Partner)' },
  { name: 'NumCad',       type: 'Numero', description: 'Registration number of the current employee' },
  { name: 'EmpAtu',       type: 'Numero', description: 'Active company number (synonym for NumEmp in some contexts)' },
  { name: 'vExecucaoRegra', type: 'Numero', description: 'Rule execution phase: 0 = before event, 1 = after event' },
  { name: 'CgiAddr',      type: 'Alfa',   description: 'CGI server address (web context only)' },
  { name: 'WnConector',   type: 'Alfa',   description: 'Web connector path (web context only)' },
  { name: 'MediaAvaDet',  type: 'Numero', description: 'Performance evaluation detail average (output variable, set by rule)' },
  { name: 'TipoAvaDet',   type: 'Alfa',   description: 'Evaluation type being processed: "C" = competency, "P" = potential, "E" = experience' },
  { name: 'RetDatRev',    type: 'Data',   description: 'Returned equipment review date (set by CalculaDataRev)' },
  { name: 'TipOpePes',    type: 'Numero', description: 'Survey operation type: 1 = save (partial), 2 = conclude (final)' },
  { name: 'ListaRequisicoesAnuncio', type: 'Alfa', description: 'Pipe-delimited list of requisition codes for the current job posting' },
  { name: 'R000RPP.CodPro', type: 'Numero', description: 'Process code that triggered this rule (via process context table)' },
];

// ─────────────────────────────────────────────────────────────────────────────
// CURSOR METHODS
// ─────────────────────────────────────────────────────────────────────────────
export const CURSOR_METHODS = [
  { name: 'SQL',          signature: 'cursor.SQL "SELECT ... FROM ... WHERE ..."', description: 'Assign SQL query text to the cursor. Bind parameters use :varName syntax. Use backslash line continuation (\\) for multi-line SQL strings.' },
  { name: 'AbrirCursor',  signature: 'cursor.AbrirCursor()',  description: 'Open the cursor and execute the SQL query. Binds :param variables from the current scope.' },
  { name: 'Achou',        signature: 'cursor.Achou',          description: 'Boolean property — true if the cursor is positioned on a valid row.' },
  { name: 'NaoAchou',     signature: 'cursor.NaoAchou',       description: 'Boolean property — negation of Achou. True if no row found.' },
  { name: 'Proximo',      signature: 'cursor.Proximo()',      description: 'Advance the cursor to the next row. Sets Achou to false if no more rows.' },
  { name: 'FecharCursor', signature: 'cursor.FecharCursor()', description: 'Close the cursor and release resources. Always call after loop.' },
  { name: 'ColName',      signature: 'cursor.ColName',        description: 'Access column value by name (matches SELECT column list). E.g., cursor.NumEmp, cursor.NomFun.' },
];

// ─────────────────────────────────────────────────────────────────────────────
// BUILTIN CATALOG
// ─────────────────────────────────────────────────────────────────────────────
export const BUILTIN_CATALOG = [
  // ── Message / Flow Control ──
  {
    name: 'Mensagem',
    signature: 'Mensagem(tipo, "texto")',
    description: 'Display a message dialog. tipo: Retorna (confirmation with Continuar/Cancelar buttons), Erro (error — blocks operation), Alerta (warning). Returns 1 if the user clicks "Continuar" (Retorna mode only).',
    category: 'message',
    example: 'Mensagem(Erro, "Cadastro incompleto!");',
  },
  {
    name: 'MensagemLog',
    signature: 'MensagemLog("texto")',
    description: 'Write a message to the system log file without showing a dialog to the user.',
    category: 'message',
    example: 'MensagemLog("Processamento concluido com sucesso.");',
  },
  {
    name: 'Cancel',
    signature: 'Cancel(codigo)',
    description: 'Cancel the current operation. 0 = cancel unconditionally, 1 = cancel with user confirmation dialog, 2 = return a calculated value (rule sets the output field, system uses it instead of its own calculation).',
    category: 'message',
    example: 'Cancel(2);  @ Return computed value to system @',
  },

  // ── Date Functions ──
  {
    name: 'DataHoje',
    signature: 'DataHoje(variavel)',
    description: 'Store today\'s date into the given Data variable.',
    category: 'date',
    example: 'Definir Data xHoje;\nDataHoje(xHoje);',
  },
  {
    name: 'DesMontaData',
    signature: 'DesMontaData(data, dia, mes, ano)',
    description: 'Decompose a date into day, month, and year components (output parameters).',
    category: 'date',
    example: 'Definir Numero xDia; Definir Numero xMes; Definir Numero xAno;\nDesMontaData(xData, xDia, xMes, xAno);',
  },
  {
    name: 'MontaData',
    signature: 'MontaData(dia, mes, ano, data)',
    description: 'Compose a date from day, month, year parts. The last parameter receives the result.',
    category: 'date',
    example: 'Definir Data xData;\nMontaData(1, 3, 2026, xData);',
  },
  {
    name: 'BusQtdDiasMes',
    signature: 'BusQtdDiasMes(mes, ano, maiorDia)',
    description: 'Get the number of days in a given month/year. Result stored in maiorDia.',
    category: 'date',
    example: 'BusQtdDiasMes(2, 2026, xDias);  @ Feb 2026 -> 28 @',
  },
  {
    name: 'RetornaMesData',
    signature: 'RetornaMesData(data, mes)',
    description: 'Extract the month number from a date.',
    category: 'date',
    example: 'RetornaMesData(xData, xMes);',
  },
  {
    name: 'RetornaAnoData',
    signature: 'RetornaAnoData(data, ano)',
    description: 'Extract the year from a date.',
    category: 'date',
    example: 'RetornaAnoData(xData, xAno);',
  },
  {
    name: 'DataExtenso',
    signature: 'DataExtenso(data, alfaResultado)',
    description: 'Convert a date to its written-out Portuguese text form (e.g., "24 de marco de 2026").',
    category: 'date',
    example: 'Definir Alfa xExt;\nDataExtenso(xData, xExt);',
  },

  // ── String Functions ──
  {
    name: 'IntParaAlfa',
    signature: 'IntParaAlfa(numero, alfa)',
    description: 'Convert an integer/number to its string representation. Second parameter is the output.',
    category: 'string',
    example: 'Definir Alfa aNum;\nIntParaAlfa(xNumCad, aNum);',
  },
  {
    name: 'AlfaParaInt',
    signature: 'AlfaParaInt(alfa, numero)',
    description: 'Parse a string as an integer/number. Second parameter is the output.',
    category: 'string',
    example: 'AlfaParaInt("123", xVal);',
  },
  {
    name: 'TrocaString',
    signature: 'TrocaString(origem, busca, substituto, resultado)',
    description: 'Replace all occurrences of busca in origem with substituto. Result goes to the 4th parameter.',
    category: 'string',
    example: 'TrocaString(xNome, ";", "", xNomeLimpo);',
  },
  {
    name: 'TamanhoAlfa',
    signature: 'TamanhoAlfa(alfa, tamanho)',
    description: 'Get the length of a string. Second parameter receives the length.',
    category: 'string',
    example: 'TamanhoAlfa(xTexto, xLen);',
  },
  {
    name: 'LerPosicaoAlfa',
    signature: 'LerPosicaoAlfa(alfa, caractere, posicao)',
    description: 'Read the character at a given 1-based position in a string.',
    category: 'string',
    example: 'LerPosicaoAlfa(xTexto, xChar, 5);',
  },
  {
    name: 'CopiarAlfa',
    signature: 'CopiarAlfa(alfa, tamanho, inicio)',
    description: 'Extract a substring. Modifies alfa in-place to contain tamanho characters starting at inicio (1-based).',
    category: 'string',
    example: 'CopiarAlfa(xTexto, 3, 1);  @ first 3 chars @',
  },
  {
    name: 'ConverteCodificacaoString',
    signature: 'ConverteCodificacaoString(origem, "encoding", destino)',
    description: 'Convert string encoding (e.g., "UTF-8", "ISO-8859-1"). Used before writing files for platform interop.',
    category: 'string',
    example: 'ConverteCodificacaoString(aLinha, "UTF-8", aLinha);',
  },
  {
    name: 'RetornaAscii',
    signature: 'RetornaAscii(codigo, caractere)',
    description: 'Return the character for a given ASCII code. Commonly used for CR (13), LF (10).',
    category: 'string',
    example: 'Definir Alfa xCR;\nRetornaAscii(13, xCR);  @ carriage return @',
  },
  {
    name: 'Formatar',
    signature: 'Formatar(valor, "mascara")',
    description: 'Format a numeric value using a printf-style mask string. Returns formatted string.',
    category: 'string',
    example: 'xStr = Formatar(xNum, "%2.0f");',
  },
  {
    name: 'ConverteMascara',
    signature: 'ConverteMascara(tam, dec, alfa, mascara)',
    description: 'Apply a display mask to a string value. tam = total length, dec = decimal places.',
    category: 'string',
    example: 'ConverteMascara(5, 0, xCod, "99");',
  },
  {
    name: 'Concatena',
    signature: 'Concatena(parte1, parte2, ..., resultado)',
    description: 'Multi-argument concatenation. Last parameter receives the concatenated result. Alternative to the + operator for many parts.',
    category: 'string',
    example: 'Concatena(xNome, " ", xSobrenome, xNomeCompleto);',
  },

  // ── Null / Check ──
  {
    name: 'EstaNulo',
    signature: 'EstaNulo(variavel, resultado)',
    description: 'Check if a variable is null or empty. resultado receives 1 if null/empty, 0 otherwise.',
    category: 'check',
    example: 'EstaNulo(xValor, xEhNulo);\nSe (xEhNulo = 1) { ... }',
  },

  // ── Math ──
  {
    name: 'ArredondarValor',
    signature: 'ArredondarValor(valor, decimais)',
    description: 'Round a numeric value to the specified number of decimal places. Modifies valor in-place.',
    category: 'math',
    example: 'ArredondarValor(xTotal, 2);',
  },

  // ── File I/O ──
  {
    name: 'Abrir',
    signature: 'Abrir(caminho, modo)',
    description: 'Open a file and return a file handle. modo: Gravarnl (write/create), Lernl (read). Assign the result to a variable.',
    category: 'file',
    example: 'fArquivo = Abrir(xCaminho, Gravarnl);',
  },
  {
    name: 'Fechar',
    signature: 'Fechar(handle)',
    description: 'Close an open file handle.',
    category: 'file',
    example: 'Fechar(fArquivo);',
  },
  {
    name: 'Gravarnl',
    signature: 'Gravarnl(handle, conteudo)',
    description: 'Write a line of text to a file (appends newline). The handle comes from Abrir().',
    category: 'file',
    example: 'Gravarnl(fArquivo, "NumEmp;NomFun");',
  },

  // ── Configuration ──
  {
    name: 'RetornaValorCFG',
    signature: 'RetornaValorCFG("chave", variavel)',
    description: 'Read a system configuration value by key (from senior.cfg / SeniorConfigCenter). Result stored in variavel.',
    category: 'config',
    example: 'RetornaValorCFG("com.senior.vetorh.impexp.default_dir", xDir);',
  },

  // ── Web Validation (CSWeb context) ──
  {
    name: 'WCheckValInteger',
    signature: 'WCheckValInteger(campo, rotulo, variavel, obrigatorio, maximo)',
    description: 'Validate and read an integer web form field. campo = HTML field name, rotulo = label for error messages, obrigatorio = "S"/"N", maximo = max value. Sets variavel to the field value.',
    category: 'web',
    example: 'WCheckValInteger("NumEmp", "Empresa", xNumEmp, "S", 9999);',
  },
  {
    name: 'WCheckValString',
    signature: 'WCheckValString(campo, rotulo, variavel, obrigatorio, maximo)',
    description: 'Validate and read a string web form field. maximo = max length.',
    category: 'web',
    example: 'WCheckValString("NomFun", "Nome", xNome, "S", 100);',
  },
  {
    name: 'WCheckValData',
    signature: 'WCheckValData(campo, rotulo, variavel, obrigatorio)',
    description: 'Validate and read a date web form field.',
    category: 'web',
    example: 'WCheckValData("DatAdm", "Data Admissao", xDat, "S");',
  },
  {
    name: 'WCheckValDouble',
    signature: 'WCheckValDouble(campo, rotulo, variavel, obrigatorio, maximo)',
    description: 'Validate and read a decimal/float web form field.',
    category: 'web',
    example: 'WCheckValDouble("VlrSal", "Salario", xSal, "S", 999999);',
  },
  {
    name: 'WCheckValCheckBox',
    signature: 'WCheckValCheckBox(campo, rotulo, variavel)',
    description: 'Validate and read a checkbox web form field. Returns "S" or "N".',
    category: 'web',
    example: 'WCheckValCheckBox("AtivoChk", "Ativo", xAtivo);',
  },
  {
    name: 'RetornaNomeCampoFrmtEvidencia',
    signature: 'RetornaNomeCampoFrmtEvidencia(campo, seqCpt, seqEvd, resultado)',
    description: 'Build the formatted HTML field name for an evidence field in web forms.',
    category: 'web',
    example: 'RetornaNomeCampoFrmtEvidencia("NotAva", xSeqCpt, xSeqEvd, xCampo);',
  },

  // ── Platform / Senior X Integration ──
  {
    name: 'getAccessToken',
    signature: 'getAccessToken(token, erro, detalheErro)',
    description: 'Obtain a Senior X Platform authentication token. Requires accesskey/secretkey configured in SeniorConfigCenter.',
    category: 'platform',
    example: 'Definir Alfa aToken; Definir Alfa aErr; Definir Alfa aDetail;\ngetAccessToken(aToken, aErr, aDetail);',
  },
  {
    name: 'carregarCSVplataforma',
    signature: 'carregarCSVplataforma(arquivo, tabela, tabelaDef, token, comando, erro, detalheErro)',
    description: 'Upload a CSV file to the Senior X Platform (BPM tables). token from getAccessToken().',
    category: 'platform',
    example: 'carregarCSVplataforma(xArquivo, "colaborador", xDef, aToken, aCmd, aErr, aDetail);',
  },

  // ── Organization / Hierarchy ──
  {
    name: 'RetNivLoc',
    signature: 'RetNivLoc(tabOrg, codLoc, data, nivel)',
    description: 'Get the hierarchy level of a location in the org chart. nivel is the output (depth from root).',
    category: 'organization',
    example: 'RetNivLoc(xTabOrg, xCodLoc, datsis, nNivel);',
  },
  {
    name: 'RetNumLocNiv',
    signature: 'RetNumLocNiv(tabOrg, numLoc, data, nivel, numLocSup)',
    description: 'Get the parent location number at a specific hierarchy level. numLocSup is the output.',
    category: 'organization',
    example: 'RetNumLocNiv(nTabOrg, nNumLoc, datsis, nNivCol, nNumLocSup);',
  },
  {
    name: 'RetornaCodLoc',
    signature: 'RetornaCodLoc(numLoc, codLoc)',
    description: 'Get the location code string from a numeric location number.',
    category: 'organization',
    example: 'RetornaCodLoc(xNumLoc, xCodLoc);',
  },

  // ── Domain-Specific: Headcount / Staffing ──
  {
    name: 'ConferirQuadroEfetivo',
    signature: 'ConferirQuadroEfetivo(numEmp, datRef, "", "", "")',
    description: 'Check the headcount/staffing table for inconsistencies between planned vacancies and actual employees. Returns >0 if inconsistencies found, 0 if OK.',
    category: 'domain',
    example: 'xRet = ConferirQuadroEfetivo(xNumEmp, xDatRef, "", "", "");',
  },
  {
    name: 'RetornaConferenciaQuaEfe',
    signature: 'RetornaConferenciaQuaEfe(operacao, xOrigem, xTabOrg, xNumLoc, xCodCCu, xEstCar, xCodCar, xTipVag, xQtdVag)',
    description: 'Iterate headcount inconsistency results. operacao: "PRIMEIRO" (first), "PROXIMO" (next), "LIBERA" (release). Returns 0 while records available.',
    category: 'domain',
    example: 'xRet = RetornaConferenciaQuaEfe("PRIMEIRO", xOrig, xTab, xLoc, xCCu, xEst, xCar, xTip, xQtd);',
  },

  // ── Domain-Specific: Equipment Review ──
  {
    name: 'CalculaDataRev',
    signature: 'CalculaDataRev(tipEqp, codEqp, param, datIni, datFim, tipSvc)',
    description: 'Calculate equipment review date within a date range. Sets the system variable RetDatRev with the result.',
    category: 'domain',
    example: 'CalculaDataRev(R098EQP.TipEqp, R098EQP.CodEqp, 0, xDatIni, xDatFim, R098RTE.TipSvc);',
  },

  // ── Domain-Specific: Performance Evaluation ──
  {
    name: 'RetornaListaObjetivos',
    signature: 'RetornaListaObjetivos(operacao)',
    description: 'Iterator for performance evaluation objectives. "I" = initialize/first, "P" = next (proximo). Returns 0 while objectives available, -1 if not in an evaluation context.',
    category: 'domain',
    example: 'xTem = RetornaListaObjetivos("I");\nEnquanto (xTem = 0) { ... xTem = RetornaListaObjetivos("P"); }',
  },

  // ── Domain-Specific: Survey / Research ──
  {
    name: 'RetornaPerguntas',
    signature: 'RetornaPerguntas(operacao)',
    description: 'Iterator for survey questions. "I" = initialize/first, "P" = next. Returns 0 while questions available, -1 if not applicable.',
    category: 'domain',
    example: 'xTem = RetornaPerguntas("I");\nEnquanto (xTem = 0) { ... xTem = RetornaPerguntas("P"); }',
  },
  {
    name: 'CarregaRespostasPorPergunta',
    signature: 'CarregaRespostasPorPergunta(codPer)',
    description: 'Load all responses for a given question code. Call before iterating with RetornaRespostasPorPergunta.',
    category: 'domain',
    example: 'CarregaRespostasPorPergunta(xCodPer);',
  },
  {
    name: 'RetornaRespostasPorPergunta',
    signature: 'RetornaRespostasPorPergunta(operacao)',
    description: 'Iterator for responses of the question loaded by CarregaRespostasPorPergunta. "I" = first, "P" = next.',
    category: 'domain',
    example: 'xTem = RetornaRespostasPorPergunta("I");\nEnquanto (xTem = 0) { ... xTem = RetornaRespostasPorPergunta("P"); }',
  },

  // ── Domain-Specific: Lists ──
  {
    name: 'DescItemLista',
    signature: 'DescItemLista(lista, codigo, descricao)',
    description: 'Get the description for a code in a system list (dropdown). lista = system list name (e.g., "LSitRqu").',
    category: 'domain',
    example: 'DescItemLista("LSitRqu", "1", xDesc);',
  },
  {
    name: 'ListaQuantidade',
    signature: 'ListaQuantidade(lista, separador, quantidade)',
    description: 'Count items in a delimited string. quantidade receives the count.',
    category: 'domain',
    example: 'ListaQuantidade(ListaRequisicoesAnuncio, "|", xQtd);',
  },
  {
    name: 'ListaItem',
    signature: 'ListaItem(lista, separador, indice, item)',
    description: 'Get the item at a 1-based index from a delimited string.',
    category: 'domain',
    example: 'ListaItem(ListaRequisicoesAnuncio, "|", 1, xPrimeiro);',
  },

  // ── Domain-Specific: Scope / Abrangencia ──
  {
    name: 'MontaAbrangencia',
    signature: 'MontaAbrangencia(campo, abrangencia, resultado)',
    description: 'Build a SQL WHERE clause fragment from a scope/range definition. Used for dynamic filtering.',
    category: 'domain',
    example: 'MontaAbrangencia("NumEmp", xAbr, xWhere);',
  },

  // ── Domain-Specific: Row Counter ──
  {
    name: 'Contador',
    signature: 'Contador(tabela, where, resultado)',
    description: 'Count rows in a table matching a WHERE clause. Quick alternative to a SELECT COUNT(*) cursor.',
    category: 'domain',
    example: 'Contador("R211RES", "CODPSQ = 1 AND SEQPSQ = 1", xQtd);',
  },

  // ── Email ──
  {
    name: 'EnviaEMail',
    signature: 'EnviaEMail(remetente, destinatario, copia, cco, assunto, texto, anexo, tipo)',
    description: 'Send an email. tipo: 1 = text, 2 = HTML. anexo = file path or empty. All parameters are Alfa.',
    category: 'email',
    example: 'EnviaEMail("rh@empresa.com", "gestor@empresa.com", "", "", "Relatorio", xCorpo, "", 1);',
  },

  // ── Flow Chart (Career Map) ──
  {
    name: 'FluxoBasico_Criar',
    signature: 'FluxoBasico_Criar(titulo, legenda)',
    description: 'Create a new flow chart (career map visualization). Must call before other FluxoBasico_ functions.',
    category: 'flowchart',
    example: 'FluxoBasico_Criar("Mapa de Carreira", "Legenda");',
  },
  {
    name: 'FluxoBasico_AdicionarSecao',
    signature: 'FluxoBasico_AdicionarSecao(id, ordem, param)',
    description: 'Add a section/level to the flow chart.',
    category: 'flowchart',
    example: 'FluxoBasico_AdicionarSecao(1, 1, "");',
  },
  {
    name: 'FluxoBasico_AdicionarCaixa',
    signature: 'FluxoBasico_AdicionarCaixa(id, cor, titulo, param)',
    description: 'Add a box (node) to the flow chart with a color and title.',
    category: 'flowchart',
    example: 'FluxoBasico_AdicionarCaixa(1, "#3366CC", "Analista Jr", "");',
  },
  {
    name: 'FluxoBasico_AdicionarItem',
    signature: 'FluxoBasico_AdicionarItem(id, texto, estilo, link, tooltip)',
    description: 'Add a detail item inside a flow chart box.',
    category: 'flowchart',
    example: 'FluxoBasico_AdicionarItem(1, "Requisito: Graduacao", "", "", "");',
  },
  {
    name: 'FluxoBasico_AdicionarImagem',
    signature: 'FluxoBasico_AdicionarImagem(id, src, param, ordem)',
    description: 'Add an image to a flow chart box.',
    category: 'flowchart',
    example: 'FluxoBasico_AdicionarImagem(1, "foto.jpg", "", 1);',
  },
  {
    name: 'FluxoBasico_AdicionarLegenda',
    signature: 'FluxoBasico_AdicionarLegenda(descricao, cor)',
    description: 'Add a legend entry to the flow chart.',
    category: 'flowchart',
    example: 'FluxoBasico_AdicionarLegenda("Cargo atual", "#FF0000");',
  },
  {
    name: 'FluxoBasico_Finalizar',
    signature: 'FluxoBasico_Finalizar()',
    description: 'Finalize and render the flow chart. Must be the last FluxoBasico_ call.',
    category: 'flowchart',
    example: 'FluxoBasico_Finalizar();',
  },

  // ── Exam Generation (Health & Safety) ──
  {
    name: 'GerSolExa_ConsultarListaExames',
    signature: 'GerSolExa_ConsultarListaExames(op, numEmp, codFic, codExa, datSol)',
    description: 'Query the medical exam list for exam generation. op controls the query mode.',
    category: 'exam',
    example: 'GerSolExa_ConsultarListaExames(1, xNumEmp, xCodFic, xCodExa, xDatSol);',
  },
  {
    name: 'GerSolExa_AdicionarExameLista',
    signature: 'GerSolExa_AdicionarExameLista(numEmp, codFic, codExa, datSol, datRes, oriExa, codOem, oemExa, codAte)',
    description: 'Add an exam to the generation list.',
    category: 'exam',
    example: 'GerSolExa_AdicionarExameLista(xNumEmp, xCodFic, xCodExa, xDat, xDatRes, 1, 0, "", 0);',
  },
  {
    name: 'GerSolExa_RemoverExameLista',
    signature: 'GerSolExa_RemoverExameLista()',
    description: 'Remove the current exam from the generation list.',
    category: 'exam',
    example: 'GerSolExa_RemoverExameLista();',
  },
  {
    name: 'GerSolExa_LimparListaExames',
    signature: 'GerSolExa_LimparListaExames()',
    description: 'Clear all exams from the generation list.',
    category: 'exam',
    example: 'GerSolExa_LimparListaExames();',
  },

  // ── SQL Functional API ──
  {
    name: 'SQL_Criar',
    signature: 'SQL_Criar(handle)',
    description: 'Create a SQL handle for the functional SQL API. handle is an Alfa variable (not a Cursor).',
    category: 'sql_api',
    example: 'Definir Alfa hSQL;\nSQL_Criar(hSQL);',
  },
  {
    name: 'SQL_DefinirComando',
    signature: 'SQL_DefinirComando(handle, sql)',
    description: 'Set the SQL command text on the handle.',
    category: 'sql_api',
    example: 'SQL_DefinirComando(hSQL, "SELECT NOMFUN FROM R034FUN WHERE NUMEMP = :pEmp");',
  },
  {
    name: 'SQL_DefinirInteiro',
    signature: 'SQL_DefinirInteiro(handle, "param", valor)',
    description: 'Bind an integer parameter to the SQL command.',
    category: 'sql_api',
    example: 'SQL_DefinirInteiro(hSQL, "pEmp", xNumEmp);',
  },
  {
    name: 'SQL_DefinirAlfa',
    signature: 'SQL_DefinirAlfa(handle, "param", valor)',
    description: 'Bind a string parameter to the SQL command.',
    category: 'sql_api',
    example: 'SQL_DefinirAlfa(hSQL, "pNome", xNome);',
  },
  {
    name: 'SQL_DefinirData',
    signature: 'SQL_DefinirData(handle, "param", valor)',
    description: 'Bind a date parameter to the SQL command.',
    category: 'sql_api',
    example: 'SQL_DefinirData(hSQL, "pData", xData);',
  },
  {
    name: 'SQL_AbrirCursor',
    signature: 'SQL_AbrirCursor(handle)',
    description: 'Execute the SQL command and open a result cursor.',
    category: 'sql_api',
    example: 'SQL_AbrirCursor(hSQL);',
  },
  {
    name: 'SQL_EOF',
    signature: 'SQL_EOF(handle)',
    description: 'Check if the cursor reached end-of-file. Returns 0 if a row is available, non-zero if done.',
    category: 'sql_api',
    example: 'Enquanto (SQL_EOF(hSQL) = 0) { ... SQL_Proximo(hSQL); }',
  },
  {
    name: 'SQL_RetornarInteiro',
    signature: 'SQL_RetornarInteiro(handle, "campo", variavel)',
    description: 'Read an integer column value from the current row.',
    category: 'sql_api',
    example: 'SQL_RetornarInteiro(hSQL, "NumEmp", xNumEmp);',
  },
  {
    name: 'SQL_RetornarAlfa',
    signature: 'SQL_RetornarAlfa(handle, "campo", variavel)',
    description: 'Read a string column value from the current row.',
    category: 'sql_api',
    example: 'SQL_RetornarAlfa(hSQL, "NomFun", xNome);',
  },
  {
    name: 'SQL_RetornarData',
    signature: 'SQL_RetornarData(handle, "campo", variavel)',
    description: 'Read a date column value from the current row.',
    category: 'sql_api',
    example: 'SQL_RetornarData(hSQL, "DatAdm", xData);',
  },
  {
    name: 'SQL_Proximo',
    signature: 'SQL_Proximo(handle)',
    description: 'Advance the SQL cursor to the next row.',
    category: 'sql_api',
    example: 'SQL_Proximo(hSQL);',
  },
  {
    name: 'SQL_FecharCursor',
    signature: 'SQL_FecharCursor(handle)',
    description: 'Close the SQL cursor (but keep the handle for reuse).',
    category: 'sql_api',
    example: 'SQL_FecharCursor(hSQL);',
  },
  {
    name: 'SQL_Destruir',
    signature: 'SQL_Destruir(handle)',
    description: 'Destroy the SQL handle and free all resources. Call when completely done.',
    category: 'sql_api',
    example: 'SQL_Destruir(hSQL);',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// MODULE CONTEXTS
// ─────────────────────────────────────────────────────────────────────────────
export const MODULE_CONTEXTS = {
  FPRG: {
    moduleDesc: 'Folha de Pagamento (Payroll) — Rubi module. Rules triggered during payroll calculation, employee data exports, and integration with Senior X Platform.',
    tables: [
      { name: 'R034FUN', description: 'Employee master (cadastro de funcionarios): NumEmp, TipCol, NumCad, NomFun, SitAfa, CodCar, CodCCu, NumLoc, TabOrg, EstCar, NumCra' },
      { name: 'R034CPL', description: 'Employee complement data: FicReg (registration form number)' },
      { name: 'R034USU', description: 'Employee-to-user mapping: CodUsu' },
      { name: 'R030EMP', description: 'Company master: NumEmp, NomEmp, CtlQua, ConTpV' },
      { name: 'R030ORG', description: 'Company org chart config: TabOrg, DatAlt' },
      { name: 'R016HIE', description: 'Org chart hierarchy: TabOrg, NumLoc, CodLoc, DatIni' },
      { name: 'R016ORN', description: 'Org chart location names: TabOrg, NumLoc, NomLoc, DatExt' },
      { name: 'R018CCU', description: 'Cost centers: NumEmp, CodCCu, NomCCu, DatExt' },
      { name: 'R024CAR', description: 'Job positions/careers: EstCar, CodCar, TitRed' },
      { name: 'R999USU', description: 'System users: CodUsu, NomUsu' },
    ],
    systemVars: ['NumEmp', 'TipCol', 'NumCad', 'EmpAtu', 'datsis'],
    returnSemantics: 'Cancel(0) = abort payroll calc for this employee. Cancel(1) = abort with confirmation. Cancel(2) = return a computed value in the designated output field (system skips its own calculation).',
    webSupport: false,
    exampleRules: ['FPRG005.LSP', 'FPRG800.LSP'],
    commonPatterns: [
      'Generate medical records during payroll processing (FPRG005)',
      'Export employee data to CSV and upload to Senior X Platform via BPM (FPRG800)',
      'Calculate custom payroll components and return via Cancel(2)',
      'Traverse org hierarchy to find managers (RetNivLoc + RetNumLocNiv)',
      'File I/O: Abrir + Gravarnl + Fechar pattern for CSV generation',
    ],
  },

  CSRG: {
    moduleDesc: 'Cargos e Salarios (Job & Salary / Career & Compensation) — Rules for performance evaluation, competency assessment, career maps, and headcount control.',
    tables: [
      { name: 'R077CDE', description: 'Competency eval details: NumEmp, TipCol, NumCad, CmpAva, TipAva, FamCnc, CodCnc, CodAva, CodIte, NotAva' },
      { name: 'R077PDE', description: 'Potential eval details: NumEmp, TipCol, NumCad, CmpAva, TipAva, CodHTe, CodAva, CodIte, NotAva' },
      { name: 'R079EDE', description: 'Experience eval details: NumEmp, TipCol, NumCad, CmpAva, TipAva, CodHPe, CodAva, CodIte, NotAva' },
      { name: 'R101AVA', description: 'Performance evaluation master: NumEmp, TipCol, NumCad' },
      { name: 'R101RES', description: 'Evaluation results/objectives: NumEmp, TipCol, NumCad, CodCic, TipAva, SeqAva, IdeObj, DesObj, NotObj, PerObj, ComChe, ComEmp' },
      { name: 'R022VAG', description: 'Vacancy types: TipVag, DesTip' },
    ],
    systemVars: ['TipoAvaDet', 'MediaAvaDet', 'VerWeb'],
    returnSemantics: 'Cancel(1) = abort save with error. MediaAvaDet is a special output variable — set it to return the computed evaluation average to the system.',
    webSupport: true,
    exampleRules: ['CSRG003.LSP', 'CSRG004.LSP', 'CSRG005.LSP', 'CSRG006.LSP', 'CSRG007.LSP'],
    commonPatterns: [
      'Calculate evaluation score averages from detail tables (CSRG003)',
      'VerWeb branching: desktop uses table field access, web uses WCheckVal* functions (CSRG005)',
      'Iterator pattern for objectives: RetornaListaObjetivos("I") / ("P")',
      'Headcount conference: ConferirQuadroEfetivo + RetornaConferenciaQuaEfe iterator + email report (QLRG001)',
      'Career map rendering with FluxoBasico_* functions',
    ],
  },

  RSRG: {
    moduleDesc: 'Recrutamento e Selecao (Recruitment & Selection) — Rules triggered during candidate hiring, requisition management, and job posting workflows.',
    tables: [
      { name: 'R126CAN', description: 'Candidates: OriCan (origin: 1=internal, 2=external)' },
      { name: 'R126RQU', description: 'Requisitions: CodRqu, SitRqu (status)' },
      { name: 'R034FUN', description: 'Employee master (target record when hiring)' },
      { name: 'R034CPL', description: 'Employee complement (target record when hiring)' },
      { name: 'R036DEP', description: 'Dependents: NumCad, CodDep' },
      { name: 'R110FIC', description: 'Medical records: CodFic' },
    ],
    systemVars: ['ListaRequisicoesAnuncio', 'VerWeb'],
    returnSemantics: 'Cancel(0) = block hiring/operation. Cancel(1) = block with confirmation. Mensagem(Erro, ...) + Cancel(1) = show error and prevent save.',
    webSupport: true,
    exampleRules: ['RSRG001.LSP', 'RSRG008.LSP'],
    commonPatterns: [
      'Set badge number on hire: R034FUN.NumCra = R034FUN.NumCad (RSRG001)',
      'Set registration form number on hire (RSRG001)',
      'Generate medical record codes for dependents (FPRG005)',
      'Validate requisition list: iterate ListaRequisicoesAnuncio with ListaQuantidade/ListaItem (RSRG008)',
      'Check requisition status before allowing changes (RSRG008)',
    ],
  },

  SMRG: {
    moduleDesc: 'Saude e Seguranca do Trabalho (Occupational Health & Safety) — Rules for equipment review scheduling, risk assessment, PPE (EPI) management, and medical exam generation.',
    tables: [
      { name: 'R098EQP', description: 'Equipment: TipEqp, CodEqp' },
      { name: 'R098RTE', description: 'Equipment review types: TipSvc' },
      { name: 'R082AGT', description: 'Risk agents: CodAgt' },
      { name: 'R083AGT', description: 'Risk agent assignment' },
      { name: 'R083LAU', description: 'Risk assessment reports (laudos): NumEmp, CmpPpa, TabOrg, NumLoc, CodGru, CodAgt, DatLau, QuaAge, QuaCol' },
      { name: 'R083LAM', description: 'Risk measurement data: QuaAge' },
      { name: 'R083EPI', description: 'PPE (EPI) for risk agents: CodEpi' },
      { name: 'R096EPI', description: 'PPE master: CodEpi, FatRed (reduction factor)' },
    ],
    systemVars: ['RetDatRev'],
    returnSemantics: 'Cancel(1) = cancel the equipment review. RetDatRev is both input (current calculated review date) and output (can be modified by CalculaDataRev).',
    webSupport: false,
    exampleRules: ['SMRG001.LSP', 'SMRG005.LSP', 'SMRG006.LSP', 'SMRG007.LSP', 'SMRG008.LSP'],
    commonPatterns: [
      'Cancel equipment reviews within a date window (SMRG001)',
      'Calculate risk quantification as average of measurements (SMRG005)',
      'Apply PPE reduction factor to risk quantification (SMRG005)',
      'Equipment review date calculation with CalculaDataRev (SMRG001)',
      'Medical exam list management with GerSolExa_* functions',
    ],
  },

  TRRG: {
    moduleDesc: 'Treinamento (Training) — Rules for training surveys, survey validation, and LMS (Pesquisa LR) question/answer processing.',
    tables: [
      { name: 'R211DEF', description: 'Survey definition: CodPsq, SeqPsq, ForApr (form type: 1=per question, 2=single form)' },
      { name: 'R211PSQ', description: 'Survey-question link: CodQue' },
      { name: 'R211IDP', description: 'Survey respondent identification: SeqIde' },
      { name: 'R211PER', description: 'Survey answers (per question): CodPer, ValRes, ResSub, DatRes' },
      { name: 'R211RES', description: 'Survey responses (per answer option): ResAss ("S"/"N"), ValRes, PriRes' },
      { name: 'R210PER', description: 'Question definition: CodQue, CodPer, TipPeQ (type: 1=single, 2=multi, 3=numeric, 4=ranked, 5=text, 6=date)' },
    ],
    systemVars: ['TipOpePes', 'VerWeb', 'MenLog'],
    returnSemantics: 'Cancel(1) = prevent survey save/conclusion. MenLog = "text" sets the error message displayed to the user.',
    webSupport: true,
    exampleRules: ['TRRG001.LSP', 'TRRG002.LSP', 'TRRG003.LSP', 'TRRG004.LSP', 'TRRG005.LSP'],
    commonPatterns: [
      'Validate all survey questions answered before conclusion (TRRG003)',
      'VerWeb branching: web uses WCheckVal* + dynamic field names, desktop uses iterator functions (TRRG003)',
      'Dynamic web field names: "CodPer_" + index, "PriRes_" + index + "_" + subIndex',
      'Iterator pattern: RetornaPerguntas("I"/"P") + CarregaRespostasPorPergunta + RetornaRespostasPorPergunta("I"/"P")',
      'Weight/importance distribution validation (TRRG003)',
      'TipOpePes branching: 1=save (lighter validation), 2=conclude (full validation)',
    ],
  },

  QLRG: {
    moduleDesc: 'Qualidade de Vida (Quality of Life / Wellness) — Rules for headcount auditing, employee well-being metrics, and operational email reports.',
    tables: [
      { name: 'R034FUN', description: 'Employee master' },
      { name: 'R030EMP', description: 'Company master: CtlQua (headcount control type: 0=by location, 1=by cost center), ConTpV (vacancy type control)' },
      { name: 'R016ORN', description: 'Org chart location names' },
      { name: 'R018CCU', description: 'Cost centers' },
      { name: 'R024CAR', description: 'Job positions' },
      { name: 'R022VAG', description: 'Vacancy types' },
    ],
    systemVars: ['EmpAtu', 'datsis'],
    returnSemantics: 'Typically informational rules — no Cancel needed. Output is usually an email report sent via EnviaEMail.',
    webSupport: false,
    exampleRules: ['QLRG001.LSP'],
    commonPatterns: [
      'Headcount audit: ConferirQuadroEfetivo + RetornaConferenciaQuaEfe iterator (QLRG001)',
      'Build HTML/text email body from query results',
      'DataExtenso for human-readable dates in reports',
      'EnviaEMail for automated notification delivery',
      'RetornaCodLoc + cursor lookups for location/cost center names',
    ],
  },

  BSRG: {
    moduleDesc: 'Beneficios (Benefits) — Rules for benefit plan calculations, reimbursement processing, and benefit enrollment validation.',
    tables: [
      { name: 'R166LAN', description: 'Benefit transaction: VlrLan (submitted value), VlrRee (reimbursement value — output field)' },
      { name: 'R166AUX', description: 'Benefit auxiliary data (available for consultation during rule execution)' },
    ],
    systemVars: ['NumEmp', 'TipCol', 'NumCad'],
    returnSemantics: 'Cancel(2) = system uses R166LAN.VlrRee as the reimbursement value instead of calculating its own. Cancel(0) or Cancel(1) = reject the benefit transaction.',
    webSupport: false,
    exampleRules: ['TRRG001.LSP'],
    commonPatterns: [
      'Calculate custom reimbursement percentage: VlrRee = VlrLan * factor (TRRG001)',
      'Cancel(2) to return the computed reimbursement value',
      'Read R166LAN fields for submitted amounts, apply business rules, write back to R166LAN.VlrRee',
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// REFERENCE SECTIONS — Pre-formatted text blocks for the language reference tool
// ─────────────────────────────────────────────────────────────────────────────
export const REFERENCE_SECTIONS = {

  // ── list ──
  list: `# Senior Rule Language — Available Reference Sections

| Section       | Description                                                    |
|---------------|----------------------------------------------------------------|
| syntax        | Complete syntax reference (declarations, control flow, blocks) |
| types         | Type system: Numero, Alfa, Data, Cursor                       |
| builtins      | All built-in functions organized by category                   |
| cursor_api    | Cursor-based SQL API (Definir Cursor, .SQL, .AbrirCursor)     |
| sql_api       | Functional SQL API (SQL_Criar, SQL_DefinirComando, etc.)      |
| system_vars   | System variables (VerWeb, datsis, NumEmp, etc.)                |
| operators     | Arithmetic, comparison, logical, and string operators          |
| web_api       | Web validation pattern (WCheckVal* functions)                  |
| patterns      | Common idioms, naming conventions, and best practices          |
| modules       | Module prefixes (FPRG, CSRG, RSRG, etc.) and their contexts   |

Use: lang_reference({ section: "<name>" }) to read any section.`,

  // ── syntax ──
  syntax: `# Senior Rule Language — Syntax Reference

## Execution Model
- Top-to-bottom imperative execution — no main function
- Rule scripts run in the context of a triggering event (save, calculate, validate)
- Case-INSENSITIVE keywords (Se, se, SE are all valid)
- Semicolons are REQUIRED after Definir statements; elsewhere they are OPTIONAL but recommended

## Variable Declaration
\`\`\`senior
Definir Numero xContador;       @ integer or float @
Definir Alfa xNome;             @ string / alphanumeric @
Definir Data xHoje;             @ date @
Definir Cursor cFuncionarios;   @ SQL cursor handle @
\`\`\`
Variables must be declared before use. No initialization in declaration (assign separately).

## Function Declaration & Definition
\`\`\`senior
@ Forward declaration (must appear before any call): @
definir funcao calcularTotal();

@ Function body (appears later in the file): @
funcao calcularTotal(); {
    @ ... code ...
    @ No explicit return statement — use output parameters or write to table fields @
}
\`\`\`
Functions take no explicit parameters — they access outer-scope variables (effectively closures).

## Block Syntax
Two interchangeable block styles, freely mixed:
\`\`\`senior
@ C-style braces: @
{ statement1; statement2; }

@ Pascal-style: @
Inicio
    statement1;
    statement2;
Fim;
\`\`\`
Both are equivalent. Braces are more common in modern rules.

## Control Flow

### If / Else
\`\`\`senior
Se (condicao) {
    @ true branch @
}
Senao {
    @ false branch @
}

@ Chained: @
Se (x = 1) { ... }
Senao Se (x = 2) { ... }
Senao { ... }
\`\`\`
Parentheses around the condition are required.

### While Loop (only loop construct — no for loop)
\`\`\`senior
Enquanto (condicao) {
    @ loop body @
}
\`\`\`

## Assignment & Equality
The \`=\` operator is overloaded:
- In \`Se (x = 1)\` → comparison (equality test)
- In \`x = 1;\` → assignment
Context determines meaning. There is no \`==\` operator.

## Comments
\`\`\`senior
@ This is a brace-style comment. Can span
  multiple lines. @

/* This is a C-style block comment.
   Also multiline. */
\`\`\`

## String Literals & Concatenation
\`\`\`senior
xNome = "Joao da Silva";
xCompleto = xNome + " Junior";    @ + concatenates strings @

@ Char literal (single character): @
Se (xChar = '\\') { ... }
\`\`\`

## Table Field Access (Database)
\`\`\`senior
xNumEmp = R034FUN.NumEmp;        @ read from table @
R034FUN.NumCra = R034FUN.NumCad;  @ write to table @
\`\`\`
Dot notation with the table name prefix. Available tables depend on the rule's trigger context.

## Array / Subscript Access
\`\`\`senior
xValor = ResAssTeste[xCodRes];   @ indexed access @
\`\`\`

## Line Continuation (in SQL strings)
\`\`\`senior
cCursor.sql "SELECT a, b, c \\
             FROM r034fun \\
             WHERE numemp = :xNumEmp";
\`\`\`
Backslash before newline continues the string on the next line.`,

  // ── types ──
  types: `# Senior Rule Language — Type System

## Numero (Number)
- Represents both integers and floating-point values
- Default value: 0
- Arithmetic: +, -, *, /
- Date arithmetic: Data + Numero = Data (adds days), Data - Data = Numero (difference in days)
- Coercion: implicit in some contexts, explicit via IntParaAlfa() / AlfaParaInt()

## Alfa (String / Alphanumeric)
- Variable-length text string
- Default value: "" (empty string)
- Concatenation: + operator
- Comparison: = (equality), <> (inequality); case-sensitive
- Null/empty check: EstaNulo(var, result) or comparison with ""
- Escape sequences in double-quoted strings: \\\\ (backslash), \\" (quote)

## Data (Date)
- Internal date representation (numeric serial date)
- Default value: 0 (represents "no date" / null date)
- Arithmetic: Data + Numero = Data, Data - Numero = Data, Data - Data = Numero
- Comparison: standard operators (<, >, =, etc.)
- A date of 0 is the conventional null/empty date check: \`Se (xData = 0)\`
- Assign from system: \`xHoje = datsis;\` or \`DataHoje(xHoje);\`

## Cursor (SQL Cursor Handle)
- Declared like other types: \`Definir Cursor cMyCur;\`
- Not a scalar — used only with cursor methods (.SQL, .AbrirCursor, .Achou, .Proximo, .FecharCursor)
- Column values accessed as properties: cMyCur.ColName

## Type Coercion
- Numero → Alfa: IntParaAlfa(numero, alfa)
- Alfa → Numero: AlfaParaInt(alfa, numero)
- Data → components: DesMontaData(data, dia, mes, ano)
- Components → Data: MontaData(dia, mes, ano, data)
- No direct Data ↔ Alfa conversion — decompose first, then format`,

  // ── builtins ──
  builtins: (() => {
    const categories = {};
    for (const fn of BUILTIN_CATALOG) {
      if (!categories[fn.category]) categories[fn.category] = [];
      categories[fn.category].push(fn);
    }
    const labels = {
      message: 'Message / Flow Control',
      date: 'Date Functions',
      string: 'String Functions',
      check: 'Null / Check',
      math: 'Math',
      file: 'File I/O',
      config: 'Configuration',
      web: 'Web Validation (CSWeb)',
      platform: 'Platform / Senior X Integration',
      organization: 'Organization / Hierarchy',
      domain: 'Domain-Specific',
      email: 'Email',
      flowchart: 'Flow Chart (Career Map)',
      exam: 'Exam Generation (Health & Safety)',
      sql_api: 'Functional SQL API',
    };
    let text = '# Senior Rule Language — Built-in Functions\n\n';
    for (const [cat, fns] of Object.entries(categories)) {
      text += `## ${labels[cat] || cat}\n\n`;
      for (const fn of fns) {
        text += `### ${fn.name}\n`;
        text += `\`${fn.signature}\`\n`;
        text += `${fn.description}\n`;
        text += `\`\`\`senior\n${fn.example}\n\`\`\`\n\n`;
      }
    }
    return text;
  })(),

  // ── cursor_api ──
  cursor_api: `# Senior Rule Language — Cursor API Reference

The Cursor API is the primary way to execute SQL queries and iterate results.

## Declaration
\`\`\`senior
Definir Cursor cMyCursor;
\`\`\`

## Setting the SQL Query
\`\`\`senior
cMyCursor.SQL "SELECT NUMEMP, NOMFUN, DATADM FROM R034FUN WHERE NUMEMP = :xNumEmp AND SITAFA <> 7";
\`\`\`

### Bind Parameters
Use \`:variableName\` in the SQL string. The runtime binds the variable's current value when AbrirCursor() is called.
\`\`\`senior
Definir Numero xEmp;
xEmp = 1;
cMyCursor.SQL "SELECT * FROM R034FUN WHERE NUMEMP = :xEmp";
@ :xEmp is replaced with the value 1 at cursor open time @
\`\`\`

### Multi-line SQL (backslash continuation)
\`\`\`senior
cMyCursor.SQL "SELECT r034fun.numemp, r034fun.nomfun \\
               FROM r034fun \\
               WHERE r034fun.sitafa <> 7 \\
               ORDER BY r034fun.nomfun";
\`\`\`

## Opening & Iterating
\`\`\`senior
cMyCursor.AbrirCursor();
Enquanto (cMyCursor.Achou) {
    xNome = cMyCursor.NomFun;    @ access column by name @
    xEmp  = cMyCursor.NumEmp;
    @ ... process row ...
    cMyCursor.Proximo();          @ advance to next row @
}
cMyCursor.FecharCursor();         @ ALWAYS close when done @
\`\`\`

## Single-Row Lookup Pattern
\`\`\`senior
cMyCursor.SQL "SELECT NOMFUN FROM R034FUN WHERE NUMEMP = :xEmp AND NUMCAD = :xCad";
cMyCursor.AbrirCursor();
Se (cMyCursor.Achou) {
    xNome = cMyCursor.NomFun;
}
cMyCursor.FecharCursor();
\`\`\`

## Reuse
A cursor can be reused by assigning a new .SQL and calling .AbrirCursor() again (after closing the previous one).

## Properties Summary
| Property/Method    | Description                                     |
|--------------------|-------------------------------------------------|
| .SQL "..."         | Set the SQL query text                          |
| .AbrirCursor()     | Execute query, position on first row            |
| .Achou             | True if positioned on a valid row               |
| .NaoAchou          | True if no (more) rows                          |
| .Proximo()         | Advance to next row                             |
| .FecharCursor()    | Close cursor, release resources                 |
| .ColumnName        | Access column value by SELECT alias/name        |`,

  // ── sql_api ──
  sql_api: `# Senior Rule Language — Functional SQL API

An alternative to the Cursor API. Uses an Alfa handle instead of a Cursor type.
Useful when you need explicit typed parameter binding or want to avoid Cursor declarations.

## Complete Workflow
\`\`\`senior
Definir Alfa hSQL;
Definir Numero xNumEmp;
Definir Alfa xNomFun;

xNumEmp = 1;

SQL_Criar(hSQL);
SQL_DefinirComando(hSQL, "SELECT NOMFUN FROM R034FUN WHERE NUMEMP = :pEmp");
SQL_DefinirInteiro(hSQL, "pEmp", xNumEmp);
SQL_AbrirCursor(hSQL);

Enquanto (SQL_EOF(hSQL) = 0) {
    SQL_RetornarAlfa(hSQL, "NomFun", xNomFun);
    MensagemLog(xNomFun);
    SQL_Proximo(hSQL);
}

SQL_FecharCursor(hSQL);
SQL_Destruir(hSQL);
\`\`\`

## Function Reference
| Function                                    | Description                              |
|---------------------------------------------|------------------------------------------|
| SQL_Criar(handle)                           | Create SQL handle                        |
| SQL_DefinirComando(handle, sql)             | Set SQL command text                     |
| SQL_DefinirInteiro(handle, "param", valor)  | Bind integer parameter                   |
| SQL_DefinirAlfa(handle, "param", valor)     | Bind string parameter                    |
| SQL_DefinirData(handle, "param", valor)     | Bind date parameter                      |
| SQL_AbrirCursor(handle)                     | Execute and open cursor                  |
| SQL_EOF(handle)                             | 0 = row available, non-zero = done       |
| SQL_RetornarInteiro(handle, "campo", var)   | Read integer column                      |
| SQL_RetornarAlfa(handle, "campo", var)      | Read string column                       |
| SQL_RetornarData(handle, "campo", var)      | Read date column                         |
| SQL_Proximo(handle)                         | Advance to next row                      |
| SQL_FecharCursor(handle)                    | Close cursor (handle remains valid)      |
| SQL_Destruir(handle)                        | Destroy handle and free resources        |

## Key Differences from Cursor API
- Handle is an **Alfa** variable, not a **Cursor** type
- Parameters are explicitly typed (DefinirInteiro vs DefinirAlfa)
- EOF check via **SQL_EOF(h) = 0** instead of **.Achou**
- Column access via **SQL_Retornar*()** functions instead of dot notation
- Must explicitly **SQL_Destruir()** when done`,

  // ── system_vars ──
  system_vars: (() => {
    let text = '# Senior Rule Language — System Variables\n\n';
    text += 'These variables are pre-populated by the runtime and available in all rules.\n\n';
    text += '| Variable | Type | Description |\n';
    text += '|----------|------|-------------|\n';
    for (const v of SYSTEM_VARIABLES) {
      text += `| \`${v.name}\` | ${v.type} | ${v.description} |\n`;
    }
    text += '\n## Usage Notes\n\n';
    text += '- **VerWeb** is the most important branching variable — almost every web-capable rule checks it first.\n';
    text += '- **datsis** is the server system date, equivalent to calling DataHoje() but available as a direct variable.\n';
    text += '- **MenLog** is a write-only variable: assigning to it writes to the log and (in web context) displays the message.\n';
    text += '- **EmpAtu** and **NumEmp** are typically equivalent; use EmpAtu for cross-company rules.\n';
    text += '- **vExecucaoRegra** distinguishes "before" rules (0) from "after" rules (1) for the same event.\n';
    text += '- **R000RPP.CodPro** identifies which process number triggered this rule — useful for multi-purpose rules.\n';
    return text;
  })(),

  // ── operators ──
  operators: `# Senior Rule Language — Operators

## Arithmetic
| Operator | Description      | Example         |
|----------|------------------|-----------------|
| +        | Addition / Concat | x = a + b      |
| -        | Subtraction      | x = a - b       |
| *        | Multiplication   | x = a * b       |
| /        | Division         | x = a / b       |
| ++       | Post-increment   | xIndice++       |
| --       | Post-decrement   | nNivel--        |
| - (unary)| Negation         | x = -y          |

## Comparison
| Operator | Description       | Example           |
|----------|-------------------|-------------------|
| =        | Equal             | Se (x = 1)       |
| <>       | Not equal         | Se (x <> "")     |
| <        | Less than         | Se (x < 10)      |
| >        | Greater than      | Se (x > 0)       |
| <=       | Less or equal     | Se (x <= 100)    |
| >=       | Greater or equal  | Se (x >= 1)      |

## Logical
| Operator | Description | Example                        |
|----------|-------------|--------------------------------|
| e        | AND         | Se ((a > 0) e (b > 0))        |
| ou       | OR          | Se ((a = 1) ou (b = 1))       |

Note: \`e\` and \`ou\` are case-insensitive (E, OU also valid).
There is no NOT operator — use \`<>\` for negation or rephrase conditions.

## String
| Operator | Description   | Example                  |
|----------|---------------|--------------------------|
| +        | Concatenation | xFull = xFirst + " " + xLast |

## Assignment
| Operator | Description | Example          |
|----------|-------------|------------------|
| =        | Assign      | xNum = 42;       |

**IMPORTANT**: \`=\` is used for BOTH assignment and equality comparison.
The parser determines meaning from context:
- After \`Se (\`, \`Enquanto (\`, or as part of a larger expression → comparison
- As a standalone statement → assignment

## Operator Precedence (highest to lowest)
| Level | Operators               | Associativity |
|-------|-------------------------|---------------|
| 8     | ++ -- - (unary)         | Right/Postfix |
| 7     | * /                     | Left          |
| 6     | + -                     | Left          |
| 5     | < > <= >=               | Left          |
| 4     | = <>                    | Left          |
| 3     | e (AND)                 | Left          |
| 2     | ou (OR)                 | Left          |

Always use parentheses to make precedence explicit, especially with \`e\`/\`ou\`:
\`\`\`senior
@ GOOD: explicit grouping @
Se ((x > 0) e (y < 10)) { ... }

@ BAD: ambiguous without parens @
Se (x > 0 e y < 10) { ... }
\`\`\``,

  // ── web_api ──
  web_api: `# Senior Rule Language — Web API / CSWeb Validation

## Overview
Rules can execute in two contexts:
1. **Desktop** (VerWeb = 0) — field values accessed directly from table objects
2. **Web / CSWeb** (VerWeb = 1) — field values read via WCheckVal* validation functions

## Standard Pattern
\`\`\`senior
Se (VerWeb = 1) {
    @ Web context: read and validate form fields @
    WCheckValInteger("NumEmp", "Empresa", xNumEmp, "S", 9999);
    WCheckValString("NomFun", "Nome Funcionario", xNome, "S", 100);
    WCheckValData("DatAdm", "Data Admissao", xData, "S");
    WCheckValDouble("VlrSal", "Salario", xSalario, "N", 999999);
    WCheckValCheckBox("AtivoChk", "Ativo", xAtivo);
}
Senao {
    @ Desktop context: direct table field access @
    xNumEmp = R034FUN.NumEmp;
    xNome = R034FUN.NomFun;
    xData = R034FUN.DatAdm;
}
\`\`\`

## WCheckVal* Parameters
| Parameter    | Description                                          |
|--------------|------------------------------------------------------|
| campo        | HTML form field name (string). Must match the web form |
| rotulo       | Label text for error messages (Portuguese)            |
| variavel     | Output variable that receives the field value         |
| obrigatorio  | "S" = required (error if empty), "N" = optional       |
| maximo       | Max value (integer/double) or max length (string)     |

## Dynamic Field Names (Grid/List Context)
When working with web grids, field names include an index suffix:
\`\`\`senior
IntParaAlfa(xIndex, xSuffix);
xCampo = "CodPer_" + xSuffix;
WCheckValInteger(xCampo, "Codigo Pergunta", xCodPer, "S", 0);

@ Nested grids use compound suffixes: @
xCampo = "PriRes_" + xIdPer + "_" + xIdRes;
WCheckValDouble(xCampo, "Valor", xValor, "S", 0);
\`\`\`

## Error Handling in Web Context
- WCheckVal* functions return error text if validation fails
- Use \`MenLog = "error text";\` to display errors in the web interface
- Use \`Cancel(1);\` to prevent the save operation
- \`Mensagem(Erro, "text")\` also works but MenLog is preferred in web context`,

  // ── patterns ──
  patterns: `# Senior Rule Language — Common Patterns & Best Practices

## 1. Variable Naming Conventions
| Prefix | Type    | Example    | Description                   |
|--------|---------|------------|-------------------------------|
| x      | any     | xNumEmp    | Local variable (most common)  |
| a      | Alfa    | aLinha     | String variable               |
| n      | Numero  | nTotal     | Numeric variable              |
| v      | any     | vTxtEma    | Value/parameter variable      |
| y      | any     | yDesObj    | Alternate local prefix        |
| C/Cur_ | Cursor  | CAux, Cur_R034 | Cursor prefix             |
| f      | file    | fArquivo   | File handle                   |
| h      | handle  | hSQL       | SQL API handle                |
| str_   | Alfa    | str_codper | String representation of a number |

## 2. VerWeb Branching
Almost every web-capable rule checks VerWeb first:
\`\`\`senior
Se (VerWeb = 1) {
    @ Web: use WCheckVal* for field access @
}
Senao {
    @ Desktop: use Table.Field access @
}
\`\`\`

## 3. Iterator Pattern (Senior-specific functions)
\`\`\`senior
xResult = FuncName("I");       @ "I" = Initialize / first @
Enquanto (xResult = 0) {
    @ process current item (access via table fields) @
    xResult = FuncName("P");   @ "P" = Proximo / next @
}
\`\`\`
Functions using this: RetornaListaObjetivos, RetornaPerguntas, RetornaRespostasPorPergunta, RetornaConferenciaQuaEfe

## 4. Cancel() Semantics
\`\`\`senior
Cancel(0);   @ Cancel operation unconditionally @
Cancel(1);   @ Cancel with confirmation / error display @
Cancel(2);   @ Return computed value (payroll/benefit rules) @
\`\`\`

## 5. Cursor Reuse Pattern
\`\`\`senior
Definir Cursor CAux;

@ First query @
CAux.SQL "SELECT NOMLOC FROM R016ORN WHERE NUMLOC = :xNumLoc";
CAux.AbrirCursor();
Se (CAux.Achou) xLocal = CAux.NomLoc;
CAux.FecharCursor();

@ Reuse same cursor for a different query @
CAux.SQL "SELECT NOMCCU FROM R018CCU WHERE CODCCU = :xCodCCu";
CAux.AbrirCursor();
Se (CAux.Achou) xCCusto = CAux.NomCCu;
CAux.FecharCursor();
\`\`\`

## 6. CSV File Export Pattern
\`\`\`senior
fArq = Abrir(xCaminho, Gravarnl);
aLinha = "col1" + SEP + "col2" + SEP + "col3";
ConverteCodificacaoString(aLinha, "UTF-8", aLinha);
Gravarnl(fArq, aLinha);

cCursor.AbrirCursor();
Enquanto (cCursor.Achou) {
    aLinha = "";
    IntParaAlfa(cCursor.col1, aAux);  aLinha = aLinha + aAux;
    aLinha = aLinha + SEP + cCursor.col2;
    ConverteCodificacaoString(aLinha, "UTF-8", aLinha);
    Gravarnl(fArq, aLinha);
    cCursor.Proximo();
}
cCursor.FecharCursor();
Fechar(fArq);
\`\`\`

## 7. Delimited List Processing
\`\`\`senior
ListaQuantidade(xLista, "|", xQtd);
xInd = 0;
Enquanto (xQtd > xInd) {
    xInd++;
    ListaItem(xLista, "|", xInd, xItem);
    @ process xItem @
}
\`\`\`

## 8. Newline Construction
\`\`\`senior
Definir Alfa xCR; Definir Alfa xLF; Definir Alfa xQuebraLinha;
RetornaAscii(13, xCR);
RetornaAscii(10, xLF);
xQuebraLinha = xCR + xLF;
\`\`\`

## 9. User Confirmation Dialog
\`\`\`senior
xResp = Mensagem(Retorna, "Deseja continuar com a operacao?");
Se (xResp <> 1) {
    Cancel(0);
}
\`\`\`

## 10. Error Reporting Pattern
\`\`\`senior
@ Accumulate errors, show all at once @
xErros = "";
Se (xCampo1 = "") xErros = xErros + "Campo 1 obrigatorio." + xQuebraLinha;
Se (xCampo2 = 0)  xErros = xErros + "Campo 2 obrigatorio." + xQuebraLinha;
Se (xErros <> "") {
    Mensagem(Erro, xErros);
    Cancel(1);
}
\`\`\`

## 11. Date Arithmetic
\`\`\`senior
xDatIni = RetDatRev - 180;   @ 180 days before @
xDatFim = RetDatRev + 180;   @ 180 days after @
\`\`\`

## 12. Forward Declaration for Functions
\`\`\`senior
@ ALL forward declarations at the top @
definir funcao getToken();
definir funcao processarDados();
definir funcao gravarLinha();

@ Main script code in the middle @
getToken();
processarDados();

@ Function definitions at the bottom @
funcao getToken(); { ... }
funcao processarDados(); { ... }
funcao gravarLinha(); { ... }
\`\`\``,

  // ── modules ──
  modules: (() => {
    let text = '# Senior Rule Language — Module Contexts\n\n';
    text += 'Rules are identified by module prefix (e.g., FPRG005 = payroll rule #5).\n\n';
    for (const [prefix, ctx] of Object.entries(MODULE_CONTEXTS)) {
      text += `## ${prefix} — ${ctx.moduleDesc}\n\n`;
      text += `**Web support**: ${ctx.webSupport ? 'Yes (VerWeb branching needed)' : 'No (desktop only)'}\n`;
      text += `**Return semantics**: ${ctx.returnSemantics}\n`;
      text += `**Example rules**: ${ctx.exampleRules.join(', ')}\n\n`;
      text += '**Key tables**:\n';
      for (const t of ctx.tables) {
        text += `- \`${t.name}\` — ${t.description}\n`;
      }
      text += `\n**System variables**: ${ctx.systemVars.map(v => `\`${v}\``).join(', ')}\n\n`;
      text += '**Common patterns**:\n';
      for (const p of ctx.commonPatterns) {
        text += `- ${p}\n`;
      }
      text += '\n---\n\n';
    }
    return text;
  })(),
};

// ─────────────────────────────────────────────────────────────────────────────
// BUILTIN_ARITY — Map of function name (lowercase) to {min, max} argument counts
// Derived from empirical analysis of 20 decoded example rule files.
// Used for arity checking in the LSP server and compiler.
// All keys are lowercase for case-insensitive lookup: fn.toLowerCase() before get().
// For functions with variant spellings both spellings are included as separate entries.
// ─────────────────────────────────────────────────────────────────────────────
export const BUILTIN_ARITY = new Map([
  // ── Messaging & control ──
  ['mensagem',                          { min: 2, max: 2 }],
  ['mensagemlog',                       { min: 1, max: 1 }],
  ['cancel',                            { min: 1, max: 1 }],

  // ── Date functions ──
  ['datahoje',                          { min: 1, max: 1 }],
  // DesMontaData and DesmontaData are both observed spellings — same arity
  ['desmontadata',                      { min: 4, max: 4 }],
  ['montadata',                         { min: 4, max: 4 }],
  ['busqtddiasMes'.toLowerCase(),       { min: 3, max: 3 }], // BusQtdDiasMes
  ['retornamesdata',                    { min: 2, max: 2 }],
  ['retornaanodata',                    { min: 2, max: 2 }],
  ['dataextenso',                       { min: 2, max: 2 }],

  // ── String / alpha functions ──
  ['intparaalfa',                       { min: 2, max: 2 }],
  ['alfaparaint',                       { min: 2, max: 2 }],
  ['trocastring',                       { min: 4, max: 4 }],
  ['tamanhoalfa',                       { min: 2, max: 2 }],
  ['lerposicaoalfa',                    { min: 3, max: 3 }],
  ['copiaralfa',                        { min: 3, max: 3 }],
  ['convertecodificacaostring',         { min: 3, max: 3 }],
  // RetornaAscii / RetornaAscII — alternate casing, both normalise to same key
  ['retornaascii',                      { min: 2, max: 2 }],
  ['formatar',                          { min: 2, max: 2 }],
  ['convertemascara',                   { min: 4, max: 4 }],
  // Concatena is variadic: minimum 3 (2 parts + resultado), maximum 10
  ['concatena',                         { min: 3, max: 10 }],
  ['estanulo',                          { min: 2, max: 2 }],
  ['arredondarvalor',                   { min: 2, max: 2 }],

  // ── File I/O ──
  ['abrir',                             { min: 2, max: 2 }],
  ['fechar',                            { min: 1, max: 1 }],
  ['gravarnl',                          { min: 2, max: 2 }],

  // ── Configuration ──
  ['retornavalorcfg',                   { min: 2, max: 2 }],

  // ── Web form validation (WCheck*) ──
  ['wcheckvalinteger',                  { min: 5, max: 5 }],
  ['wcheckvalstring',                   { min: 5, max: 5 }],
  ['wcheckvaldata',                     { min: 4, max: 4 }],
  ['wcheckvaldouble',                   { min: 5, max: 5 }],
  ['wcheckvalcheckbox',                 { min: 3, max: 3 }],

  // ── Evidence / form field helpers ──
  ['retornanomecampofrmtevidencia',     { min: 4, max: 4 }],

  // ── Platform / API integration ──
  ['getaccesstoken',                    { min: 3, max: 3 }],
  ['carregarCSVplataforma'.toLowerCase(), { min: 7, max: 7 }], // carregarcsvplataforma

  // ── Org structure helpers ──
  ['retnivloc',                         { min: 4, max: 4 }],
  ['retnumlocniv',                      { min: 5, max: 5 }],
  ['retornacodloc',                     { min: 2, max: 2 }],
  ['retcolabporcodusu',                 { min: 4, max: 4 }],

  // ── Query / staffing helpers ──
  ['contador',                          { min: 3, max: 3 }],
  ['conferirquadroefetivo',             { min: 5, max: 5 }],
  ['retornaconferenciaquaefe',          { min: 9, max: 9 }],

  // ── Equipment / review ──
  ['calculadatarev',                    { min: 6, max: 6 }],

  // ── Survey / evaluation ──
  ['retornalistaobjetivos',             { min: 1, max: 1 }],
  ['retornaperguntas',                  { min: 1, max: 1 }],
  ['carregarrespostasporpergunta',      { min: 1, max: 1 }],
  ['retornarespostasporpergunta',       { min: 1, max: 1 }],

  // ── List helpers ──
  ['descitemlista',                     { min: 3, max: 3 }],
  ['listaquantidade',                   { min: 3, max: 3 }],
  ['listaitem',                         { min: 4, max: 4 }],
  ['montaabrangencia',                  { min: 3, max: 3 }],

  // ── Email ──
  ['enviaemail',                        { min: 8, max: 8 }],

  // ── FluxoBasico (flowchart/diagram builder) ──
  ['fluxobasico_criar',                 { min: 2, max: 2 }],
  ['fluxobasico_adicionarsecao',        { min: 3, max: 3 }],
  ['fluxobasico_adicionarcaixa',        { min: 4, max: 4 }],
  ['fluxobasico_adicionaritem',         { min: 5, max: 5 }],
  ['fluxobasico_adicionarimagem',       { min: 4, max: 4 }],
  ['fluxobasico_adicionarlegenda',      { min: 2, max: 2 }],
  ['fluxobasico_finalizar',             { min: 0, max: 0 }],

  // ── GerSolExa (exam/medical test order management) ──
  ['gersolExa_ConsultarListaExames'.toLowerCase(), { min: 5, max: 5 }],
  ['gersolExa_AdicionarExameLista'.toLowerCase(),  { min: 9, max: 9 }],
  ['gersolExa_RemoverExameLista'.toLowerCase(),    { min: 0, max: 0 }],
  ['gersolExa_LimparListaExames'.toLowerCase(),    { min: 0, max: 0 }],

  // ── SQL cursor API ──
  ['sql_criar',                         { min: 1, max: 1 }],
  ['sql_definircomando',                { min: 2, max: 2 }],
  ['sql_definirinteiro',                { min: 3, max: 3 }],
  ['sql_definiralfa',                   { min: 3, max: 3 }],
  ['sql_definirdata',                   { min: 3, max: 3 }],
  ['sql_abrircursor',                   { min: 1, max: 1 }],
  ['sql_eof',                           { min: 1, max: 1 }],
  ['sql_retornarinteiro',               { min: 3, max: 3 }],
  ['sql_retornaralfa',                  { min: 3, max: 3 }],
  ['sql_retornardata',                  { min: 3, max: 3 }],
  ['sql_proximo',                       { min: 1, max: 1 }],
  ['sql_fecharcursor',                  { min: 1, max: 1 }],
  ['sql_destruir',                      { min: 1, max: 1 }],
]);
