import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { logEvent } from "@/lib/audit";
import { verifyCredentials } from "@/lib/credentials";

const isProd = process.env.VERCEL_ENV === "production";

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET,
  trustHost: true,
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 }, // 8 hours — re-login required after inactivity
  pages: { signIn: "/login" },
  cookies: isProd ? {
    sessionToken: {
      name: "__Secure-next-auth.session-token",
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: true, domain: ".primeaccountax.com" },
    },
  } : undefined,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        mfaCode: { label: "Authentication code", type: "text" },
      },
      async authorize(credentials) {
        return verifyCredentials({
          email: credentials?.email as string | undefined,
          password: credentials?.password as string | undefined,
          mfaCode: credentials?.mfaCode as string | undefined,
        });
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as any).id;
        token.role = (user as any).role;
        token.orgId = (user as any).orgId;
        token.repId = (user as any).repId ?? null;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;
        (session.user as any).role = token.role;
        (session.user as any).orgId = token.orgId;
        (session.user as any).repId = token.repId ?? null;
      }
      return session;
    },
  },
  events: {
    // Forensic trail of who logged in and when.
    async signIn({ user }) {
      const u = user as any;
      if (u?.id && u?.orgId) {
        await logEvent({ orgId: u.orgId, eventType: "user_login", actorId: u.id, actorName: u.email ?? null });
      }
    },
  },
});
