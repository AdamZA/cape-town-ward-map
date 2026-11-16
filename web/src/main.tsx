import { render } from "preact";
import { App } from "./app";
import "@fontsource-variable/public-sans";
import "./styles.css";

render(<App />, document.getElementById("app")!);
