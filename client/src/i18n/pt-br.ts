import type { Dictionary } from "./dictionary";

export const ptBr: Dictionary = {
  common: {
    add: "Adicionar",
    back: "Voltar",
    cancel: "Cancelar",
    close: "Fechar",
    copy: "Copiar",
    delete: "Excluir",
    download: "Baixar",
    edit: "Editar",
    loading: "Carregando…",
    remove: "Remover",
    rename: "Renomear",
    retry: "Tentar novamente",
    save: "Salvar",
    search: "Buscar",
    send: "Enviar",
    stop: "Parar",
  },
  settings: {
    language: {
      title: "Idioma",
      description: "Vale para o app inteiro, só neste dispositivo.",
    },
  },
  errors: {
    setCwdTitle: "Não foi possível trocar a pasta",
    setCwd: {
      locked: "Esta conversa já tem histórico, então a pasta dela é fixa.",
      not_found: "Essa pasta não existe.",
      permission_denied: "Sem permissão para abrir essa pasta.",
      not_a_directory: "Esse caminho é um arquivo, não uma pasta.",
      invalid_path: "Esse caminho não é válido — use um caminho absoluto.",
    },
    editMessage: {
      not_found: "Mensagem não encontrada — o histórico pode ter mudado.",
      truncate_failed: "Não foi possível editar essa mensagem.",
      relay_restarting: "O relay está reiniciando. Tente de novo em instantes.",
    },
  },
};
