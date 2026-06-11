import { useEffect, useState, useRef } from 'react';
import Keycloak from 'keycloak-js';
import WhiteboardDashboard from './components/WhiteboardDashboard';

const keycloakConfig = {
  url: 'http://localhost:8081', 
  realm: 'whiteboard-realm',
  clientId: 'whiteboard-app',
};

const keycloak = new Keycloak(keycloakConfig);

export default function App() {
  const [authenticated, setAuthenticated] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const isInitialized = useRef<boolean>(false); 

  useEffect(() => {
   
    if (isInitialized.current) return;
    isInitialized.current = true;

    keycloak
      .init({ 
        onLoad: 'login-required', 
        checkLoginIframe: false,
        pkceMethod: 'S256' 
      })
      .then((auth) => {
        setAuthenticated(!!auth);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Keycloak authentication initialization failed", err);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="d-flex justify-content-center align-items-center vh-100 bg-light">
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Loading Session...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-vh-100 bg-light">
      {authenticated ? (
        <WhiteboardDashboard logout={() => keycloak.logout()} />
      ) : (
        <div className="container text-center py-5">
          <p className="text-danger">Authentication required to view workspace.</p>
        </div>
      )}
    </div>
  );
}