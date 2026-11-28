import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
const geistSans=Geist({variable:"--font-geist-sans",subsets:["latin"]});
const geistMono=Geist_Mono({variable:"--font-geist-mono",subsets:["latin"]});
export const metadata:Metadata={title:"Cluster Control Room | Kubernetes Emulator",description:"An interactive Kubernetes cluster simulator and learning workbench.",keywords:["Kubernetes","cluster simulator","DevOps","container orchestration"]};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en" data-theme="night" suppressHydrationWarning><body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>{children}<Toaster/></body></html>}
