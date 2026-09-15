import { Hono } from "hono";
import users from "./admin/users.ts";
import system from "./admin/system.ts";
import operations from "./admin/operations.ts";
import channels from "./admin/channels.ts";

const admin = new Hono();

// Mount sub-routers
admin.route("/users", users);
admin.route("/channels", channels);
admin.route("/", system);
admin.route("/", operations);

export default admin;
