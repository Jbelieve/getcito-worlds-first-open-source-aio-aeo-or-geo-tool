import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NavAppInfo } from "./nav-app-info";

describe("NavAppInfo", () => {
it("shows version and Believe attribution", () => {
const html = renderToStaticMarkup(<NavAppInfo />);

expect(html).toContain(`v${__APP_VERSION__}`);
expect(html).toContain("By Believe");
expect(html).not.toContain("getcito.com");
expect(html).not.toContain("github.com");
});
});
