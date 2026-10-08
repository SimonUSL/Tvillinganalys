import App from "../ui/App";

// Teamets vy: samma flöde som kunden, plus tekniska detaljer.
// Skyddas av ADMIN_PASSWORD i middleware.ts.
export default function AdminPage() {
  return <App admin />;
}
