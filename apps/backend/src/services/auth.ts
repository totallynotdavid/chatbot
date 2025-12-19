import { db } from "../db";
import {
    encodeBase32LowerCaseNoPadding,
    encodeHexLowerCase,
} from "@oslojs/encoding";
import { sha256 } from "@oslojs/crypto/sha2";
import type { Context } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";

export interface Session {
    id: string;
    userId: string;
    expiresAt: Date;
}

export interface User {
    id: string;
    username: string;
    role: string;
}

export type SessionValidationResult =
    | { session: Session; user: User }
    | { session: null; user: null };

export function generateSessionToken(): string {
    const bytes = new Uint8Array(20);
    crypto.getRandomValues(bytes);
    const token = encodeBase32LowerCaseNoPadding(bytes);
    return token;
}

export function createSession(token: string, userId: string): Session {
    const sessionId = encodeHexLowerCase(
        sha256(new TextEncoder().encode(token)),
    );
    const session: Session = {
        id: sessionId,
        userId,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30), // 30 days
    };
    db.prepare(
        "INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)",
    ).run(
        session.id,
        session.userId,
        Math.floor(session.expiresAt.getTime() / 1000),
    );
    return session;
}

export function validateSessionToken(token: string): SessionValidationResult {
    const sessionId = encodeHexLowerCase(
        sha256(new TextEncoder().encode(token)),
    );
    const row = db
        .prepare(`
        SELECT s.id, s.user_id, s.expires_at, u.id as uid, u.username, u.role 
        FROM session s
        INNER JOIN users u ON u.id = s.user_id 
        WHERE s.id = ?
    `)
        .get(sessionId) as any;

    if (!row) {
        return { session: null, user: null };
    }

    const session: Session = {
        id: row.id,
        userId: row.user_id,
        expiresAt: new Date(row.expires_at * 1000),
    };

    const user: User = {
        id: row.uid,
        username: row.username,
        role: row.role,
    };

    if (Date.now() >= session.expiresAt.getTime()) {
        db.prepare("DELETE FROM session WHERE id = ?").run(session.id);
        return { session: null, user: null };
    }

    if (Date.now() >= session.expiresAt.getTime() - 1000 * 60 * 60 * 24 * 15) {
        session.expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
        db.prepare("UPDATE session SET expires_at = ? WHERE id = ?").run(
            Math.floor(session.expiresAt.getTime() / 1000),
            session.id,
        );
    }

    return { session, user };
}

export function invalidateSession(sessionId: string): void {
    db.prepare("DELETE FROM session WHERE id = ?").run(sessionId);
}

export function setSessionTokenCookie(
    c: Context,
    token: string,
    expiresAt: Date,
): void {
    const isProd = process.env.NODE_ENV === "production";
    setCookie(c, "session", token, {
        httpOnly: true,
        sameSite: "Lax",
        expires: expiresAt,
        path: "/",
        secure: isProd,
    });
}

export function deleteSessionTokenCookie(c: Context): void {
    const isProd = process.env.NODE_ENV === "production";
    deleteCookie(c, "session", {
        path: "/",
        secure: isProd,
    });
}
