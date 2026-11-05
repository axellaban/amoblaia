import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";

/** «Usuarios» is now «Equipo y accesos»: earlier links keep working. */
export default function UsersPage() {
  redirect("/panel/equipo");
}
