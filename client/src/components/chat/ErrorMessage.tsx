export function ErrorMessage({ message }: { message: string }) {
  return <p className="text-sm text-destructive">Erro: {message}</p>;
}
