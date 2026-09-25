import React from "react";
import { createRoot } from "react-dom/client";
import BrickGame from "./BrickGame.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrickGame />
  </React.StrictMode>
);
