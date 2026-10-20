import { Runtime } from "foldkit";

import { view } from "../features/app.js";
import { Model, init, update } from "./app.js";
import { subscriptions } from "./subscriptions.js";

import "./style.css";

Runtime.run(
  Runtime.makeApplication({
    Model,
    container: document.querySelector("#root"),
    devTools: false,
    init,
    subscriptions,
    update,
    view,
  })
);
