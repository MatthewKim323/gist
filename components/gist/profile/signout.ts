// Shared client actions for the chip and /profile. Full navigations so the cleared cookie applies everywhere.
export async function signOut(to = "/") {
  await fetch("/api/auth/session", { method: "DELETE" }).catch(() => null);
  window.location.assign(to);
}
/** Switch account: sign out and land on the picker, where recent profiles are one click away. */
export const switchAccount = () => signOut("/signin");
