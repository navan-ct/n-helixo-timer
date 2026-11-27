import { BrowserRouter } from "react-router-dom";

import { QueryProvider } from "./components";
import Routes from "./Routes";

// Any .jsx file in /pages becomes a route. See Routes.jsx for details.
const pages = import.meta.glob("./pages/**/!(*.test.[jt]sx)*.([jt]sx)", { eager: true });

export default function App() {
  return (
    <BrowserRouter>
      <QueryProvider>
        <Routes pages={pages} />
      </QueryProvider>
    </BrowserRouter>
  );
}
