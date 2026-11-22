import { redirect } from "next/navigation";

// Public self-service signup is retired. Visitors request access instead;
// accounts are created only by administrators or via reviewed requests.
export default function SignupPage() {
  redirect("/request-access");
}
