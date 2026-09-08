import { Card, Statistic } from 'antd'; export function MetricCard({title,value,prefix,suffix}:{title:string;value:any;prefix?:string;suffix?:string}){return <Card className="shadow-sm border-0"><Statistic title={title} value={value} prefix={prefix} suffix={suffix}/></Card>}

