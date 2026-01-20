import { Hono } from "hono";
import users from "./users.ts";
import system from "./system.ts";
import operations from "./operations.ts";

const admin = new Hono();

// Mount sub-routers
admin.route("/users", users);
admin.route("/", system);
admin.route("/", operations);

export default admin;
