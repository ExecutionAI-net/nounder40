// Regola password unica per registrazione, completamento invito e reset:
// il backend (validate_password) chiede 8+ caratteri e niente sole cifre;
// qui la stessa cosa detta prima del submit.
export const PASSWORD_MIN = 8

export function passwordProblem(pw: string): 'short' | 'weak' | null {
  if (pw.length < PASSWORD_MIN) return 'short'
  if (!/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) return 'weak'
  return null
}
