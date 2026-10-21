import { createFileRoute } from "@tanstack/react-router";
import { WelcomePage } from "@/components/landing/welcome-page";
import { welcomeHead } from "@/components/landing/page-head";

export const Route = createFileRoute("/welcome")({ head: welcomeHead, component: WelcomePage });
