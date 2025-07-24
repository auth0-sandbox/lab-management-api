// ACME: app.js
// Lab: Management API
//

import { ManagementClient } from "auth0";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import express from "express";
import auth0Express from "express-openid-connect";
import session from "express-session";
import createError from "http-errors";
import logger from "morgan";
import path, { dirname, normalize } from "path";
import { fileURLToPath } from "url";

const { auth, requiresAuth } = auth0Express;

dotenv.config();
process.env.ISSUER_BASE_URL = `https://${process.env.DOMAIN}`

if (!process.env.BASE_URL) {
    process.env.BASE_URL = !process.env.CODESPACE_NAME
        ? `http://localhost:${process.env.PORT}`
        : `https://${process.env.CODESPACE_NAME}-${process.env.PORT}.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`;
}

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __fileDirectory = dirname(__filename);
const __dirname = normalize(path.join(__fileDirectory, ".."));
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "pug");

app.use(logger("combined"));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

app.use(
    session({
        secret: process.env.SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: false,
            sameSite: "lax",
            secure: false,
        },
    })
);

app.use(
    auth({
        issuerBaseURL: process.env.ISSUER_BASE_URL,
        baseURL: process.env.BASE_URL,
        clientID: process.env.CLIENT_ID,
        clientSecret: process.env.CLIENT_SECRET,
        secret: process.env.SECRET,
        idpLogout: true,
        authRequired: false,
        authorizationParams: {
            response_type: "code",
            audience: process.env.BACKEND_AUDIENCE,
            scope: "openid profile email read:totals read:reports",
        },
    })
);

async function fetchProtectedResource(req, url, method, body, headers) {
    if (!req.oidc || !req.oidc.accessToken) {
        throw new Error("User does not have an access token");
    }
    const options = {
        method: method || "GET",
        body: body ? JSON.stringify(body) : null,
        headers: new Headers({
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${req.oidc.accessToken.access_token}`,
            ...headers,
        }),
    }
    const response = await fetch(url, options);
    if (!response.ok) {
        throw new Error(`Error from fetch: ${response.statusText}`)
    }
    return response;
}

app.get("/", async (req, res) => {
    let locals = { user: req.oidc && req.oidc.user, total: null, count: null }
    try {
        if (locals.user) {
            const apiUrl = `${process.env.BACKEND_URL}/expenses/${locals.user.sub}/totals`
            const response = await fetchProtectedResource(req, apiUrl)
            locals = { ...locals, ...await response.json() }
        }
    } catch (error) {
        console.error(error)
    }
    res.render("home", locals);
})

app.get("/expenses", async (req, res) => {
    let locals = { user: req.oidc && req.oidc.user, expenses: null }
    try {
        if (locals.user) {
            const apiUrl = `${process.env.BACKEND_URL}/expenses/${req.oidc.user.sub}/reports`
            const response = await fetchProtectedResource(req, apiUrl)
            locals.expenses = await response.json()
        }
    } catch (error) {
        console.error(error)
    }
    res.render("expenses", locals)
})

app.get("/user", requiresAuth(), async (req, res) => {
    res.render("user", {
        user: req.oidc && req.oidc.user,
        id_token: req.oidc && req.oidc.idToken,
        access_token: req.oidc && req.oidc.accessToken,
        refresh_token: req.oidc && req.oidc.refreshToken,
    })
})

app.get("/userinfo", async (req, res) => {
    const locals = { user: req.oidc && req.oidc.user, userinfo: null }
    try {
        if (locals.user) {
            const apiUrl = `${process.env.ISSUER_BASE_URL}/userinfo`
            const response = await fetchProtectedResource(req, apiUrl)
            locals.userinfo = await response.json()
        }
    } catch (error) {
        console.error(error)
    }
    res.render("userinfo", locals)
})

app.use((req, res, next) => next(createError(404)))

app.use((err, req, res, next) => {
    res.locals.message = err.message;
    res.locals.error = err;
    res.status(err.status || 500);
    res.render("error", {
        user: req.oidc && req.oidc.user,
    })
})

app.listen(process.env.PORT, () => {
    console.log(`WEB APP: ${process.env.BASE_URL}`)
})