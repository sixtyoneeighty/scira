'use client';

import { useEffect, useState } from 'react';

export function WelcomePopup() {
  const [isOpen, setIsOpen] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  useEffect(() => {
    const hasSeenWelcome = localStorage.getItem('hasSeenWelcome');
    if (!hasSeenWelcome) {
      setIsOpen(true);
    }
  }, []);

  const handleClose = () => {
    if (dontShowAgain) {
      localStorage.setItem('hasSeenWelcome', 'true');
    }
    setIsOpen(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/30" aria-hidden="true" onClick={handleClose} />
      
      <div className="flex min-h-full items-center justify-center p-4">
        <div 
          className="relative mx-auto max-w-md rounded-lg bg-white p-6 shadow-xl"
          onClick={e => e.stopPropagation()}
        >
          <h2 className="text-lg font-medium leading-6 text-gray-900 mb-4">
            Welcome to Mojo Search Beta!
          </h2>
          
          <div className="mt-2">
            <p className="text-sm text-gray-500 mb-4">
              Thank you for helping us test Mojo Search! While the basic functionality is working, 
              you might encounter some quirks as this is our first build.
            </p>
            
            <p className="text-sm text-gray-500 mb-4">
              We&apos;d greatly appreciate your feedback! If you encounter any issues or unusual behavior, 
              please email us at{' '}
              <a 
                href="mailto:support@sixtyoneeightyai.com" 
                className="text-blue-600 hover:text-blue-800"
              >
                support@sixtyoneeightyai.com
              </a>
              {' '}or message Jake directly.
            </p>
            
            <p className="text-sm text-gray-500">
              Your feedback helps us improve Mojo Search for everyone!
            </p>
          </div>

          <div className="mt-6 flex items-center">
            <input
              type="checkbox"
              id="dontShowAgain"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <label htmlFor="dontShowAgain" className="ml-2 text-sm text-gray-600">
              Don&apos;t show this message again
            </label>
          </div>

          <div className="mt-6">
            <button
              type="button"
              className="inline-flex justify-center rounded-md border border-transparent bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
              onClick={handleClose}
            >
              Got it, thanks!
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
