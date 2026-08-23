import type { Metadata } from "next";
import "./globals.css";
import "./diff.css";
export const metadata: Metadata = { title: "PR Witness", description: "Review the intent, not the diff." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
