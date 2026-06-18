export function EmptyWebProvidersState({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-destructive/50 p-4 text-sm text-destructive"
    >
      {message}
    </div>
  );
}
