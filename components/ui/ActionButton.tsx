'use client'

import React, { ReactNode } from 'react'

interface ActionButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
  variant?: 'primary' | 'secondary' | 'danger'
}

export default function ActionButton({
  children,
  variant = 'primary',
  disabled,
  ...props
}: ActionButtonProps) {
  const baseClasses =
    'w-full py-2 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed'

  const variantClasses = {
    primary: 'bg-blue-600 hover:bg-blue-700 text-white',
    secondary: 'bg-purple-600 hover:bg-purple-700 text-white',
    danger: 'bg-red-600 hover:bg-red-700 text-white',
  }

  return (
    <button
      className={`${baseClasses} ${variantClasses[variant]} ${
        disabled ? 'pointer-events-none' : ''
      }`}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  )
}

