import { memo } from "react";

export const ErrorMessage = memo(function ErrorMessage({ message }: { message: string }) {
  return <p className="text-sm text-destructive">Erro: {message}</p>;
});
