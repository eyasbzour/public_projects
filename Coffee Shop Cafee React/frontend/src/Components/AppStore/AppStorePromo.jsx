import React,{Component} from 'react';

import AppStoreImg from "../../assets/website/app_store.png";
import PlayStoreImg from "../../assets/website/play_store.png"
import BgPng from "../../assets/website/coffee-beans-bg.png";

const backgroundStyle ={
    backgroundImage: `url(${BgPng})`,
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
    height:"100%",
    width: "100%",
}
class AppStore extends Component{
    render(){
        return (
            <div style={backgroundStyle} className='py-14'>
                <div className='container'>
                    <div className="grid gird-cols-1 sm:grid-cols-2 items-center gap-4">
                        <div data-aos='fade-up'
                            className='space-y-6 max-w-xl mx-auto'>
                            {/* text sextion */}
                            <h1 className='text-2xl text-center sm:text-left sm:text-4xl font-semibold pl-3 text-white/90'>Coffee Cafe is available for Android and IOS</h1>
                             {/* logo section */}
                             <div className='flex flex-wrap justify-center sm:justify-start items-center'>
                                <a href='#'className='hover:scale-110 duration-300'>
                                    <img src={AppStoreImg} alt="" className='max-w-[150px] sm:max-w[120px] md-max-w-[200px]'/>
                                </a>
                                <a href='#' className='hover:scale-110 duration-300'>
                                    <img src={PlayStoreImg} alt="" className='max-w-[150px] sm:max-w[120px] md-max-w-[200px]'/>
                                </a>

                             </div>
                        </div>
                    </div>
                    <div></div>
                </div>
            </div>
        )
    }
}
export default AppStore;