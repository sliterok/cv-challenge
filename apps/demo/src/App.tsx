import React, { useMemo } from 'react';
import { CvChallenge } from '@cv-challenge/react-plugin';

const App: React.FC = () => {
  const pageStyle = useMemo<React.CSSProperties>(
    () => ({
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: '"Space Grotesk", "Segoe UI", sans-serif',
      background: '#f5f6f8',
      color: '#1a1a1a',
      padding: '2rem'
    }),
    []
  );

  const cardStyle = useMemo<React.CSSProperties>(
    () => ({
      width: 180
    }),
    []
  );

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <CvChallenge
          onVerify={result => {
            console.log('[verify]', result);
          }}
          onDebug={data => {
            console.log('[debug]', data);
          }}
        />
      </div>
    </div>
  );
};

export default App;
