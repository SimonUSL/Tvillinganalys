export const metadata = {
  title: "Tvillinganalys",
  description: "Tvillingbolag-sökning för Optimal Kommunikation",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sv">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body
        style={{
          fontFamily: "'Poppins', system-ui, sans-serif",
          margin: 0,
          background: "#F8F9FA",
          color: "#64646A",
        }}
      >
        {children}
      </body>
    </html>
  );
}
