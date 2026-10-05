import React from 'react';
import styles from './index.css';
import Button from 'antd/es/button'
const BasicLayout: React.FC = props => {

  return (
    <div className={styles.normal}>
      <h1 className={styles.title}>
        <span>基金投资策略分析</span>
        <nav className={styles.navActions} aria-label="主要功能">
          <Button href="#/manual" className={styles.navButton}>手动回测</Button>
          <Button href="#/compare" target="_black" className={styles.navButton}>策略比较</Button>
        </nav>
      </h1>
      {props.children}
    </div>
  );
};

export default BasicLayout;
