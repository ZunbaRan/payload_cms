'use client'

import { TextareaField } from '@payloadcms/ui'
import React from 'react'
import AiTaskFieldButton from './AiTaskFieldButton'

const AiTaskTextareaField: React.FC<any> = (props) => {
  return (
    <>
      <TextareaField {...props} />
      <AiTaskFieldButton aiTask={props.aiTask} field={props.field} clientField={props.clientField} />
    </>
  )
}

export default AiTaskTextareaField
