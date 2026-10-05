/**
 * 补仓策略表单
 */
import React, { Component, Fragment } from 'react';
import { FundFormObj } from './search-form';
import Form, { FormComponentProps } from 'antd/lib/form';
import Select  from 'antd/es/select';
import InputNumber  from 'antd/es/input-number';
import Divider  from 'antd/es/divider';
import { searchIndex, SearchIndexResp } from '@/utils/fund-stragegy/fetch-fund-data';
import throttle from 'lodash/throttle'
const { Option } = Select

const formItemLayout = {
  style: {
    width: 500
  },
  labelCol: {
    xs: { span: 24 },
    sm: { span: 8 },
  },
  wrapperCol: {
    xs: { span: 24 },
    sm: { span: 16 },
  },
};

export class BuyStragegyForm extends Component<FormComponentProps<FundFormObj>> {
  state = {
    searchIndexData: [] as SearchIndexResp[],
    searchError: ''
  }


  handleSearchIndex = throttle(async (value) => {

    if (value) {
      this.setState({ searchError: '' })
      try {
        const result = await searchIndex(value)
        this.setState({ searchIndexData: result, searchError: '' });
      } catch (error) {
        this.setState({
          searchIndexData: [],
          searchError: error && error.message ? error.message : '指数搜索失败，请稍后重试。'
        })
      }
    } else {
      this.setState({ searchIndexData: [], searchError: '' });
    }
  }, 1000)

  render() {
    const { searchIndexData, searchError } = this.state

    const { getFieldDecorator, getFieldsValue } = this.props.form;

    return <section>
      <Divider orientation="left">补仓策略 </Divider>
      <Form.Item {...formItemLayout} label="参考指数">
        {getFieldDecorator<FundFormObj>('referIndex')(
          <Select
            showSearch
            placeholder="输入指数名称或编号"
            defaultActiveFirstOption={false}
            showArrow={false}
            filterOption={false}
            onSearch={this.handleSearchIndex}
            // onChange={this.handleChange}
            notFoundContent={searchError || null}
          >
            {searchIndexData.map((d, index) => <Option key={d.id}>{d.name}[{d.code}]</Option>)}
          </Select>
        )}
      </Form.Item>

      <Form.Item {...formItemLayout} label="买入 MACD 临界点">
        {getFieldDecorator<FundFormObj>('buyMacdPoint', {
          // initialValue: 100
        })(
          <InputNumber style={{ width: '100%' }} formatter={value => `${value}%`}
            parser={value => (value || '').replace('%', '')} min={0} max={100} placeholder="macd 补仓点" />
        )
        }
      </Form.Item>

      <Form.Item {...formItemLayout} label='补仓金额'>
        <div  >
          <span>  剩余流动资金的 </span>
          {getFieldDecorator<FundFormObj>('buyAmountPercent', {
            initialValue: 20,
          })(
            <InputNumber size="small"  min={0}  
            formatter={value => Number(value) > 100 ? `${value}元` : `${value}%`}
            parser={value => (value || '').replace(/%|元/, '')}
            placeholder="补仓买入百分比" />
          )} </div>

      </Form.Item>
    </section>
  }
}


