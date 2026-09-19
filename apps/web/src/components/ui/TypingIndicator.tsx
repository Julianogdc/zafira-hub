import React from 'react';

const TypingIndicator = () => {
  return (
    <div className="flex items-center gap-1 px-1 h-6">
      <div className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-[pulse_1.5s_ease-in-out_infinite]"></div>
      <div className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-[pulse_1.5s_ease-in-out_0.2s_infinite]"></div>
      <div className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-[pulse_1.5s_ease-in-out_0.4s_infinite]"></div>
    </div>
  );
};

export default TypingIndicator;