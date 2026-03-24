// lang-templates.js — Code template generators for Senior HCM rule language
// ESM module

const TEMPLATES = {
  cursor_query: {
    name: 'cursor_query',
    description: 'Standard cursor query pattern for iterating over database results',
    generate(opts) {
      const { table, fields } = parseOpts(opts);
      const t = table || 'R034FUN';
      const ff = fields.length ? fields : ['Col1', 'Col2'];
      const fieldList = fields.length ? fields.join(', ') : 'col1, col2';
      return `@ Regra: /* TODO: descrever propósito */ @

Definir Cursor cConsulta;
Definir Numero xNumEmp;
Definir Alfa xResultado;
/* TODO: declarar mais variáveis conforme necessário */

xNumEmp = NumEmp;

cConsulta.SQL "SELECT ${fieldList} FROM ${t} WHERE NumEmp = :xNumEmp";
cConsulta.AbrirCursor();

Enquanto (cConsulta.Achou)
{
    /* TODO: processar registro */
    xResultado = cConsulta.${ff[0]};

    cConsulta.Proximo();
}
cConsulta.FecharCursor();`;
    },
  },

  sql_api_query: {
    name: 'sql_api_query',
    description: 'Alternative SQL API pattern for dynamic queries using SQL_* functions',
    generate(opts) {
      const { table, fields } = parseOpts(opts);
      const t = table || 'R034FUN';
      const ff = fields.length ? fields : ['Col1', 'Col2'];
      const fieldList = fields.length ? fields.join(', ') : 'col1, col2';
      return `@ Regra: /* TODO: descrever propósito */ @

Definir Alfa xCursor;
Definir Alfa xSQL;
Definir Numero xResultado;
/* TODO: declarar mais variáveis */

xSQL = "SELECT ${fieldList} FROM ${t} WHERE NumEmp = :NumEmp";

SQL_Criar(xCursor);
SQL_DefinirComando(xCursor, xSQL);
SQL_DefinirInteiro(xCursor, "NumEmp", NumEmp);
SQL_AbrirCursor(xCursor);

Enquanto (SQL_EOF(xCursor) = 0)
{
    SQL_RetornarInteiro(xCursor, "${ff[0]}", xResultado);
    /* TODO: processar registro */

    SQL_Proximo(xCursor);
}
SQL_FecharCursor(xCursor);
SQL_Destruir(xCursor);`;
    },
  },

  web_desktop_branch: {
    name: 'web_desktop_branch',
    description: 'VerWeb branching pattern for web/desktop dual-mode rules',
    generate(opts) {
      const { table, fields } = parseOpts(opts);
      const t = table || 'R034FUN';
      const ff = fields.length ? fields : ['NumEmp', 'NomFun'];
      const f1 = ff[0];
      const f2 = ff.length > 1 ? ff[1] : 'NomFun';
      return `@ Regra: /* TODO: descrever propósito */ @

Definir Numero xCampo1;
Definir Alfa xCampo2;
/* TODO: declarar variáveis para campos do formulário */

Se (VerWeb = 1)
{
    @ Modo Web — ler campos via WCheckVal @
    WCheckValInteger("${t}_${f1}", "Número", xCampo1, 1, 9999999);
    WCheckValString("${t}_${f2}", "Nome", xCampo2, 1, 100);
    /* TODO: adicionar mais validações web */
}
Senao
{
    @ Modo Desktop — acesso direto aos campos @
    xCampo1 = ${t}.${f1};
    xCampo2 = ${t}.${f2};
    /* TODO: ler mais campos */
}

/* TODO: lógica principal usando xCampo1, xCampo2 */`;
    },
  },

  file_export: {
    name: 'file_export',
    description: 'File export pattern for generating CSV/text output files',
    generate(opts) {
      const { table, fields } = parseOpts(opts);
      const t = table || 'R034FUN';
      const ff = fields.length ? fields : ['Col1', 'Col2'];
      const fieldList = fields.length ? fields.join(', ') : 'col1, col2';
      const f1 = ff[0];
      const f2 = ff.length > 1 ? ff[1] : 'Col2';
      return `@ Regra: Exportação de dados para arquivo @

Definir Numero farquivo;
Definir Alfa aLinha;
Definir Alfa aCaminho;
Definir Alfa SEP;
Definir Cursor cDados;
/* TODO: declarar variáveis para campos */

SEP = ";";
RetornaValorCFG("caminho_exportacao", aCaminho);
/* TODO: ou definir caminho fixo: aCaminho = "C:/Senior/export/dados.csv"; */

farquivo = Abrir(aCaminho, Gravarnl);

@ Cabeçalho @
aLinha = "${f1}" + SEP + "${f2}";
ConverteCodificacaoString(aLinha, "UTF-8", aLinha);
Gravarnl(farquivo, aLinha);

@ Dados @
cDados.SQL "SELECT ${fieldList} FROM ${t} WHERE NumEmp = :xNumEmp";
cDados.AbrirCursor();

Enquanto (cDados.Achou)
{
    aLinha = "";
    /* TODO: montar linha com campos do cursor */
    IntParaAlfa(cDados.${f1}, aLinha);
    aLinha = aLinha + SEP + cDados.${f2};

    ConverteCodificacaoString(aLinha, "UTF-8", aLinha);
    Gravarnl(farquivo, aLinha);

    cDados.Proximo();
}
cDados.FecharCursor();

Fechar(farquivo);
MensagemLog("Exportação concluída: " + aCaminho);`;
    },
  },

  platform_upload: {
    name: 'platform_upload',
    description: 'Senior X platform CSV upload pattern with authentication',
    generate() {
      return `@ Regra: Upload de dados para Plataforma Senior X @

Definir Alfa aToken;
Definir Alfa aErro;
Definir Alfa aDetalhe;
Definir Alfa aArquivo;
Definir Alfa aTabela;
Definir Alfa aTabelaDef;
Definir Alfa aComando;
Definir Numero farquivo;
Definir Alfa aLinha;
/* TODO: declarar variáveis para dados */

@ Passo 1: Gerar arquivo CSV @
aArquivo = "C:/Senior/export/upload.csv";
/* TODO: gerar CSV usando padrão file_export */

@ Passo 2: Obter token de autenticação @
getAccessToken(aToken, aErro, aDetalhe);
Se (aErro <> "")
{
    Mensagem(Erro, "Falha ao obter token: " + aErro + " - " + aDetalhe);
    Cancel(0);
}

@ Passo 3: Upload para plataforma @
aTabela = "/* TODO: nome da tabela na plataforma */";
aTabelaDef = "/* TODO: definição da tabela */";
aComando = "INSERT";

carregarCSVplataforma(aArquivo, aTabela, aTabelaDef, aToken, aComando, aErro, aDetalhe);
Se (aErro <> "")
{
    Mensagem(Erro, "Falha no upload: " + aErro + " - " + aDetalhe);
    Cancel(0);
}

MensagemLog("Upload concluído com sucesso para " + aTabela);`;
    },
  },

  calculation_rule: {
    name: 'calculation_rule',
    description: 'Calculation rule that computes and returns a value',
    generate(opts) {
      const { table, fields } = parseOpts(opts);
      const t = table || 'R034FUN';
      const ff = fields.length ? fields : ['Campo1', 'Campo2'];
      const f1 = ff[0];
      const f2 = ff.length > 1 ? ff[1] : 'Campo2';
      return `@ Regra de Cálculo: /* TODO: descrever cálculo */ @

Definir Numero xValor;
Definir Numero xBase;
Definir Numero xPercentual;
/* TODO: declarar variáveis */

@ Ler valores base @
xBase = ${t}.${f1};
xPercentual = 0;
/* TODO: definir lógica de cálculo */

@ Calcular resultado @
xValor = xBase * xPercentual / 100;
ArredondarValor(xValor, 2);

@ Retornar valor calculado @
${t}.${f2} = xValor;
Cancel(2);`;
    },
  },

  validation_rule: {
    name: 'validation_rule',
    description: 'Validation rule that checks conditions before save',
    generate(opts) {
      const { table, fields } = parseOpts(opts);
      const t = table || 'R034FUN';
      const ff = fields.length ? fields : ['Campo1'];
      const f1 = ff[0];
      return `@ Regra de Validação: /* TODO: descrever validação */ @

Definir Numero xValor;
Definir Alfa xMensagem;
Definir Numero xErro;
/* TODO: declarar variáveis */

xErro = 0;
xMensagem = "";

@ Validação 1: /* TODO: descrever */ @
xValor = ${t}.${f1};
Se (xValor = 0)
{
    xMensagem = xMensagem + "Campo1 é obrigatório.\\n";
    xErro = 1;
}

@ Validação 2: /* TODO: descrever */ @
/* TODO: adicionar mais validações */

@ Resultado @
Se (xErro = 1)
{
    Mensagem(Erro, xMensagem);
    Cancel(0);
}`;
    },
  },

  empty_rule: {
    name: 'empty_rule',
    description: 'Minimal skeleton for a new rule',
    generate() {
      return `@ Regra: /* TODO: título da regra */
   Módulo: /* TODO: FPRG, CSRG, RSRG, etc. */
   Evento: /* TODO: Antes Salvar, Após Efetivar, etc. */
   Descrição: /* TODO: descrever propósito */
@

/* TODO: declarações de variáveis */

/* TODO: lógica da regra */`;
    },
  },
};

/**
 * Parse options, splitting comma-separated fields into an array.
 */
function parseOpts(opts = {}) {
  const table = opts.table || '';
  const rawFields = opts.fields || '';
  const fields = rawFields
    ? rawFields.split(',').map((f) => f.trim()).filter(Boolean)
    : [];
  return { table, fields };
}

/**
 * Generate code from a named template.
 * @param {string} templateName - One of the template names (e.g. 'cursor_query')
 * @param {object} [options] - { table?: string, fields?: string (comma-separated) }
 * @returns {{ code: string, description: string }}
 */
export function generateTemplate(templateName, options = {}) {
  const tmpl = TEMPLATES[templateName];
  if (!tmpl) {
    const available = Object.keys(TEMPLATES).join(', ');
    throw new Error(
      `Unknown template "${templateName}". Available: ${available}`
    );
  }
  return {
    code: tmpl.generate(options),
    description: tmpl.description,
  };
}

/**
 * List all available templates.
 * @returns {Array<{ name: string, description: string }>}
 */
export function listTemplates() {
  return Object.values(TEMPLATES).map(({ name, description }) => ({
    name,
    description,
  }));
}
